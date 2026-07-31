import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  SemanticImportDuplicatePolicy,
  SemanticImportPublishRow
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  SeoDataClient,
  SeoDataClientError
} from "../seo-data/seo-data.client.js";
import { storedEntitlement } from "./keyword-research-record.js";

const MAPPING_HASH = createHash("sha256")
  .update("seo-platform:keyword-research:keys-so-import:v1", "utf8")
  .digest("hex");

@Injectable()
export class KeywordResearchImportService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly seoData: SeoDataClient
  ) {}

  public async pendingIds(): Promise<readonly string[]> {
    const now = new Date();
    const rows = await this.prisma.keywordResearchRun.findMany({
      where: {
        OR: [
          {
            status: "IMPORT_QUEUED",
            OR: [{ retryAt: null }, { retryAt: { lte: now } }]
          },
          {
            status: "IMPORTING",
            job: {
              OR: [
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lte: now } }
              ]
            }
          }
        ]
      },
      select: { id: true },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 200
    });
    return rows.map(({ id }) => id);
  }

  public async import(runId: string, leaseOwner: string): Promise<string> {
    const claimed = await this.claim(runId, leaseOwner);
    if (!claimed) return "NOT_CLAIMED";
    try {
      const rows = await this.prisma.keywordResearchRow.findMany({
        where: {
          workspaceId: claimed.workspaceId,
          projectId: claimed.projectId,
          runId: claimed.id,
          selected: true
        },
        orderBy: { ordinal: "asc" },
        take: 500
      });
      if (rows.length !== claimed.selectedKeywords || rows.length < 1) {
        throw new TypeError("Stored keyword research selection is invalid");
      }
      const normalized = await this.seoData.normalizeKeywords({
        workspaceId: claimed.workspaceId,
        projectId: claimed.projectId,
        actorId: claimed.actorId,
        importId: claimed.id,
        rows: rows.map((row) => ({
          rowNumber: String(row.ordinal),
          text: row.keyword,
          language: claimed.database === "gny" ? "en" : "ru"
        }))
      });
      const normalizedByNumber = new Map(
        normalized.rows.map((row) => [row.rowNumber, row])
      );
      const publishRows = rows.map((row): SemanticImportPublishRow => {
        const keyword = normalizedByNumber.get(String(row.ordinal));
        if (!keyword) throw new TypeError("Keyword normalization is incomplete");
        const frequencies = [
          frequency("BASE", row.frequencyBase),
          frequency("EXACT", row.frequencyExact),
          frequency("FIXED", row.frequencyFixed)
        ].filter(
          (item): item is NonNullable<typeof item> => item !== undefined
        );
        return {
          sourceRowNumber: String(row.ordinal),
          textOriginal: keyword.textOriginal,
          textNormalized: keyword.textNormalized,
          normalizedHash: keyword.normalizedHash,
          language: keyword.language,
          ...(frequencies.length > 0 ? { frequencies } : {}),
          tags: ["Keys.so", claimed.domain],
          customValues: {
            ...(row.url ? { "Keys.so URL": row.url } : {}),
            ...(row.position === null
              ? {}
              : { "Keys.so position": String(row.position) }),
            ...(row.kei === null ? {} : { "Keys.so KEI": String(row.kei) })
          }
        };
      });
      const newKeywords = normalized.rows.filter(
        ({ existsInProject }) => !existsInProject
      ).length;
      const context = {
        workspaceId: claimed.workspaceId,
        projectId: claimed.projectId,
        actorId: claimed.actorId,
        importId: claimed.id
      };
      await this.seoData.beginImport({
        ...context,
        mappingHash: MAPPING_HASH,
        duplicatePolicy: duplicatePolicy(claimed.duplicatePolicy),
        expectedChunks: 1,
        expectedUniqueRows: String(publishRows.length),
        expectedNewKeywords: String(newKeywords),
        entitlement: storedEntitlement(claimed.entitlement)
      });
      await this.seoData.applyChunk({
        ...context,
        chunkIndex: 0,
        payloadHash: createHash("sha256")
          .update(JSON.stringify(publishRows), "utf8")
          .digest("hex"),
        duplicatePolicy: duplicatePolicy(claimed.duplicatePolicy),
        rows: publishRows
      });
      const result = await this.seoData.completeImport(context);
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.keywordResearchRun.updateMany({
          where: {
            id: claimed.id,
            status: "IMPORTING",
            version: claimed.version
          },
          data: {
            status: "COMPLETED",
            importedKeywords: rows.length,
            failureCode: null,
            finishedAt: new Date(),
            version: { increment: 1 }
          }
        });
        if (updated.count !== 1) throw new Error("Keyword import lease was lost");
        await transaction.job.update({
          where: { id: claimed.jobId },
          data: {
            status: "COMPLETED",
            stage: "completed",
            progressCurrent: BigInt(rows.length),
            resultSummary: result as unknown as Prisma.InputJsonValue,
            leaseOwner: null,
            leaseExpiresAt: null,
            finishedAt: new Date(),
            version: { increment: 1 }
          }
        });
      });
      return "COMPLETED";
    } catch (error) {
      await this.recordFailure(claimed, error);
      return error instanceof SeoDataClientError && error.retryable
        ? "RETRY_SCHEDULED"
        : "FAILED";
    }
  }

  private async claim(runId: string, leaseOwner: string) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.keywordResearchRun.findUnique({
        where: { id: runId },
        include: { job: true }
      });
      if (
        !current ||
        !["IMPORT_QUEUED", "IMPORTING"].includes(current.status) ||
        (current.status === "IMPORTING" &&
          current.job.leaseExpiresAt &&
          current.job.leaseExpiresAt > new Date())
      ) {
        return undefined;
      }
      const leaseExpiresAt = new Date(Date.now() + 5 * 60_000);
      const updated = await transaction.keywordResearchRun.updateMany({
        where: { id: runId, status: current.status, version: current.version },
        data: {
          status: "IMPORTING",
          failureCode: null,
          retryAt: null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) return undefined;
      await transaction.job.update({
        where: { id: current.jobId },
        data: {
          status: "RUNNING",
          stage: "importing",
          startedAt: current.job.startedAt ?? new Date(),
          leaseOwner,
          leaseExpiresAt,
          retryAt: null,
          version: { increment: 1 }
        }
      });
      return transaction.keywordResearchRun.findUniqueOrThrow({
        where: { id: runId }
      });
    });
  }

  private async recordFailure(
    run: Awaited<ReturnType<KeywordResearchImportService["claim"]>> & {},
    error: unknown
  ): Promise<void> {
    if (!run) return;
    const retryable = error instanceof SeoDataClientError && error.retryable;
    const code =
      error instanceof SeoDataClientError
        ? `SEO_DATA_${error.code}`
        : "IMPORT_INVALID_STATE";
    const retryAt = retryable ? new Date(Date.now() + 30_000) : undefined;
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.keywordResearchRun.updateMany({
        where: { id: run.id, status: "IMPORTING", version: run.version },
        data: {
          status: retryable ? "IMPORT_QUEUED" : "FAILED",
          failureCode: code,
          ...(retryAt ? { retryAt } : { finishedAt: new Date() }),
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) return;
      await transaction.job.update({
        where: { id: run.jobId },
        data: {
          status: retryable ? "RETRY_SCHEDULED" : "FAILED_FINAL",
          retryAt: retryAt ?? null,
          errorSummary: { code },
          leaseOwner: null,
          leaseExpiresAt: null,
          ...(retryable ? {} : { finishedAt: new Date() }),
          version: { increment: 1 }
        }
      });
    });
  }
}

function duplicatePolicy(value: string | null): SemanticImportDuplicatePolicy {
  if (
    value !== "SKIP_EXISTING" &&
    value !== "MERGE_NON_EMPTY" &&
    value !== "OVERWRITE_MAPPED"
  ) {
    throw new TypeError("Stored keyword research duplicate policy is invalid");
  }
  return value;
}

function frequency(
  type: "BASE" | "EXACT" | "FIXED",
  value: number | null
): { readonly type: "BASE" | "EXACT" | "FIXED"; readonly value: string } | undefined {
  return value === null ? undefined : { type, value: String(value) };
}
