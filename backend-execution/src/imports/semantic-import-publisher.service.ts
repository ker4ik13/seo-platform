import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  domainEventTypes,
  semanticImportMaxGroupDepth,
  type InternalSemanticImportReceipt,
  type SemanticCapacityEntitlement,
  type SemanticImportMapping,
  type SemanticImportPublishRow,
  type SemanticImportResultSummary
} from "@seo-platform/contracts";
import {
  Prisma,
  type SemanticImport
} from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  SeoDataClient,
  SeoDataClientError
} from "../seo-data/seo-data.client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  safeMapping,
  safeValidation
} from "./semantic-import.service.js";

export interface SemanticImportPublishOutcome {
  readonly importId: string;
  readonly status: "COMPLETED" | "CANCELLED" | "FAILED" | "SKIPPED";
  readonly code?: string;
}

interface SemanticImportPublishPlan {
  readonly mapping: SemanticImportMapping;
  readonly uniqueRows: bigint;
  readonly newKeywords: bigint;
  readonly batchSize: number;
  readonly expectedChunks: number;
  readonly entitlement: SemanticCapacityEntitlement;
}

const SEMANTIC_IMPORT_MAX_PUBLISH_ATTEMPTS = 5;

@Injectable()
export class SemanticImportPublisherService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly seoData: SeoDataClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async pendingImports(
    limit = 100
  ): Promise<readonly { readonly id: string; readonly version: number }[]> {
    return this.prisma.semanticImport.findMany({
      where: {
        OR: [
          { status: "READY_TO_PUBLISH" },
          {
            status: "PUBLISHING",
            OR: [
              { publishingHeartbeatAt: { lt: this.staleBefore() } },
              {
                publishingHeartbeatAt: null,
                publishingStartedAt: { lt: this.staleBefore() }
              }
            ]
          },
          {
            status: "CANCEL_REQUESTED",
            OR: [
              { publishingStartedAt: null },
              { publishingHeartbeatAt: { lt: this.staleBefore() } },
              {
                publishingHeartbeatAt: null,
                publishingStartedAt: { lt: this.staleBefore() }
              }
            ]
          }
        ]
      },
      orderBy: { updatedAt: "asc" },
      take: Math.min(Math.max(limit, 1), 500),
      select: { id: true, version: true }
    });
  }

  public async publish(importId: string): Promise<SemanticImportPublishOutcome> {
    const claimedAt = new Date();
    const cancelled = await this.claimInterruptedCancellation(
      importId,
      claimedAt
    );
    if (cancelled) {
      try {
        return await this.recoverCancellation(cancelled, claimedAt);
      } catch (error) {
        await this.releaseCancellationForRetry(cancelled.id, claimedAt);
        throw error;
      }
    }
    const claimed = await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        OR: [
          { status: "READY_TO_PUBLISH" },
          {
            status: "PUBLISHING",
            OR: [
              { publishingHeartbeatAt: { lt: this.staleBefore() } },
              {
                publishingHeartbeatAt: null,
                publishingStartedAt: { lt: this.staleBefore() }
              }
            ]
          }
        ]
      },
      data: {
        status: "PUBLISHING",
        stage: "publishing_chunks",
        publishingStartedAt: claimedAt,
        publishingHeartbeatAt: claimedAt,
        publishingCompletedAt: null,
        publishingAttempts: { increment: 1 },
        failure: Prisma.DbNull,
        version: { increment: 1 }
      }
    });
    if (claimed.count === 0) {
      const current = await this.prisma.semanticImport.findUnique({
        where: { id: importId },
        select: { status: true }
      });
      if (!current) throw new NotFoundException("Import not found");
      return { importId, status: "SKIPPED", code: current.status };
    }
    const semanticImport = await this.prisma.semanticImport.findUnique({
      where: { id: importId }
    });
    if (!semanticImport) throw new NotFoundException("Import not found");
    try {
      return await this.publishClaimed(semanticImport, claimedAt);
    } catch (error) {
      if (error instanceof SeoDataClientError && !error.retryable) {
        try {
          return await this.fail(
            semanticImport,
            claimedAt,
            error.code === "QUOTA_EXCEEDED"
              ? "QUOTA_EXCEEDED"
              : "SEO_DATA_PUBLISH_REJECTED"
          );
        } catch (finalizationError) {
          await this.releaseForRetry(semanticImport.id, claimedAt);
          throw finalizationError;
        }
      }
      if (
        semanticImportPublishRetryExhausted(
          semanticImport.publishingAttempts
        )
      ) {
        try {
          return await this.fail(
            semanticImport,
            claimedAt,
            "IMPORT_PUBLISH_RETRY_EXHAUSTED"
          );
        } catch (finalizationError) {
          // Do not abandon the Core receipt: it owns the capacity
          // reservation and any already accepted idempotent chunks. A later
          // claim may safely replay those chunks before retrying finalization.
          await this.releaseForRetry(semanticImport.id, claimedAt);
          throw finalizationError;
        }
      }
      await this.releaseForRetry(semanticImport.id, claimedAt);
      throw error;
    }
  }

  private async publishClaimed(
    semanticImport: SemanticImport,
    claimedAt: Date
  ): Promise<SemanticImportPublishOutcome> {
    const plan = this.publishPlan(semanticImport);
    if ("code" in plan) {
      return this.fail(semanticImport, claimedAt, plan.code);
    }
    const { mapping, uniqueRows, batchSize, expectedChunks } = plan;
    await this.beginReceipt(semanticImport, plan);

    let afterHash: string | undefined;
    let chunkIndex = 0;
    let publishedRows = 0n;
    while (true) {
      if (await this.cancelRequested(semanticImport.id, claimedAt)) {
        return this.finishCancelled(
          semanticImport,
          claimedAt
        );
      }
      const batch = await validatedBatch(
        this.prisma,
        semanticImport.id,
        batchSize,
        afterHash,
        mapping.createMissingKeywords
      );
      if (batch.length === 0) break;
      const rows = batch.map(({ canonical_row, canonical_rows }) => {
        const sourceRows = canonical_rows ??
          (canonical_row === undefined ? [] : [canonical_row]);
        const parsed = sourceRows.map(canonicalPublishRow);
        if (parsed.length === 0 || parsed.some((row) => !row)) {
          throw new Error("Validated semantic row is invalid");
        }
        return mergeCanonicalPublishRows(
          parsed as readonly SemanticImportPublishRow[]
        );
      });
      const groupPaths =
        chunkIndex === 0 && mapping.createMissingKeywords
          ? safeKc4GroupPaths(semanticImport.sourceMetadata)
          : undefined;
      const payloadHash = hashJson(
        groupPaths ? { groupPaths, rows } : rows
      );
      await this.seoData.applyChunk({
        workspaceId: semanticImport.workspaceId,
        projectId: semanticImport.projectId,
        actorId: semanticImport.actorId,
        importId: semanticImport.id,
        chunkIndex,
        payloadHash,
        duplicatePolicy: mapping.duplicatePolicy,
        createMissingKeywords: mapping.createMissingKeywords,
        ...(groupPaths ? { groupPaths } : {}),
        rows
      });
      publishedRows += BigInt(rows.length);
      afterHash = batch.at(-1)!.normalized_hash;
      chunkIndex += 1;
      await this.heartbeat(semanticImport.id, claimedAt);
    }
    if (chunkIndex !== expectedChunks || publishedRows !== uniqueRows) {
      throw new Error("Semantic import publish row count mismatch");
    }
    const result = await this.seoData.completeImport({
      workspaceId: semanticImport.workspaceId,
      projectId: semanticImport.projectId,
      actorId: semanticImport.actorId,
      importId: semanticImport.id
    });
    return this.complete(semanticImport, claimedAt, result);
  }

  private async claimInterruptedCancellation(
    importId: string,
    claimedAt: Date
  ): Promise<SemanticImport | undefined> {
    const changed = await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        status: "CANCEL_REQUESTED",
        OR: [
          { publishingStartedAt: null },
          { publishingHeartbeatAt: { lt: this.staleBefore() } },
          {
            publishingHeartbeatAt: null,
            publishingStartedAt: { lt: this.staleBefore() }
          }
        ]
      },
      data: {
        stage: "finalizing_cancel",
        publishingStartedAt: claimedAt,
        publishingHeartbeatAt: claimedAt,
        version: { increment: 1 }
      }
    });
    if (changed.count === 0) return undefined;
    return (
      (await this.prisma.semanticImport.findUnique({
        where: { id: importId }
      })) ?? undefined
    );
  }

  private async recoverCancellation(
    semanticImport: SemanticImport,
    claimedAt: Date
  ): Promise<SemanticImportPublishOutcome> {
    return this.finishCancelled(semanticImport, claimedAt);
  }

  private publishPlan(
    semanticImport: SemanticImport
  ): SemanticImportPublishPlan | { readonly code: string } {
    const mapping = safeMapping(semanticImport.confirmedMapping);
    const validation = safeValidation(semanticImport.validationSummary);
    if (!mapping || !validation) {
      return { code: "IMPORT_VALIDATION_MISSING" };
    }
    const uniqueRows = BigInt(validation.uniqueKeywordsToProcess);
    if (uniqueRows <= 0n) {
      return { code: "IMPORT_HAS_NO_VALID_ROWS" };
    }
    const batchSize = Math.min(
      Math.max(this.config.imports.publishBatchRows, 1),
      500
    );
    const expectedChunksBig =
      (uniqueRows + BigInt(batchSize) - 1n) / BigInt(batchSize);
    if (expectedChunksBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { code: "IMPORT_TOO_MANY_CHUNKS" };
    }
    const existingKeywords = BigInt(
      validation.existingKeywordsInProject
    );
    if (existingKeywords > uniqueRows) {
      return { code: "IMPORT_VALIDATION_INVALID" };
    }
    const entitlement = importEntitlement(semanticImport);
    if (!entitlement) {
      return { code: "IMPORT_ENTITLEMENT_MISSING" };
    }
    return {
      mapping,
      uniqueRows,
      newKeywords: mapping.createMissingKeywords
        ? uniqueRows - existingKeywords
        : 0n,
      batchSize,
      expectedChunks: Number(expectedChunksBig),
      entitlement
    };
  }

  private beginReceipt(
    semanticImport: SemanticImport,
    plan: SemanticImportPublishPlan
  ): Promise<InternalSemanticImportReceipt> {
    return this.seoData.beginImport({
      workspaceId: semanticImport.workspaceId,
      projectId: semanticImport.projectId,
      actorId: semanticImport.actorId,
      importId: semanticImport.id,
      mappingHash: hashJson(plan.mapping),
      duplicatePolicy: plan.mapping.duplicatePolicy,
      createMissingKeywords: plan.mapping.createMissingKeywords,
      expectedChunks: plan.expectedChunks,
      expectedUniqueRows: plan.uniqueRows.toString(),
      expectedNewKeywords: plan.newKeywords.toString(),
      entitlement: plan.entitlement
    });
  }

  private async complete(
    semanticImport: SemanticImport,
    claimedAt: Date,
    result: SemanticImportResultSummary
  ): Promise<SemanticImportPublishOutcome> {
    return this.prisma.$transaction(async (transaction) => {
      const completedAt = new Date();
      const changed = await transaction.semanticImport.updateMany({
        where: {
          id: semanticImport.id,
          status: "PUBLISHING",
          publishingStartedAt: claimedAt
        },
        data: {
          status: "COMPLETED",
          stage: "completed",
          resultSummary: json(result),
          publishingHeartbeatAt: completedAt,
          publishingCompletedAt: completedAt,
          version: { increment: 1 }
        }
      });
      if (changed.count === 0) {
        return {
          importId: semanticImport.id,
          status: "SKIPPED" as const
        };
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: domainEventTypes.semanticImportCompleted,
          aggregateId: semanticImport.id,
          workspaceId: semanticImport.workspaceId,
          projectId: semanticImport.projectId,
          payload: json({
            importId: semanticImport.id,
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            ...result
          }),
          metadata: {
            producer: "jobs-integrations",
            source: "semantic-import-worker"
          }
        }
      });
      return {
        importId: semanticImport.id,
        status: "COMPLETED" as const
      };
    });
  }

  private async finishCancelled(
    semanticImport: SemanticImport,
    claimedAt: Date
  ): Promise<SemanticImportPublishOutcome> {
    const result = await this.terminateReceipt(
      semanticImport,
      "CANCELLED"
    );
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.semanticImport.updateMany({
        where: {
          id: semanticImport.id,
          status: "CANCEL_REQUESTED",
          publishingStartedAt: claimedAt
        },
        data: {
          status: "CANCELLED",
          stage: result ? "cancelled_partial" : "cancelled",
          ...(result ? { resultSummary: json(result) } : {}),
          publishingHeartbeatAt: new Date(),
          publishingCompletedAt: new Date(),
          version: { increment: 1 }
        }
      });
      if (changed.count === 0) return;
      await transaction.outboxEvent.create({
        data: {
          eventType: domainEventTypes.semanticImportCancelled,
          aggregateId: semanticImport.id,
          workspaceId: semanticImport.workspaceId,
          projectId: semanticImport.projectId,
          payload: json({
            importId: semanticImport.id,
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            partial: Boolean(result),
            ...result
          }),
          metadata: {
            producer: "jobs-integrations",
            source: "semantic-import-worker"
          }
        }
      });
    });
    return { importId: semanticImport.id, status: "CANCELLED" };
  }

  private async fail(
    semanticImport: SemanticImport,
    claimedAt: Date,
    code: string
  ): Promise<SemanticImportPublishOutcome> {
    const partialResult = await this.terminateReceipt(
      semanticImport,
      "FAILED_FINAL"
    );
    return this.prisma.$transaction(async (transaction) => {
      const completedAt = new Date();
      const changed = await transaction.semanticImport.updateMany({
        where: {
          id: semanticImport.id,
          status: "PUBLISHING",
          publishingStartedAt: claimedAt
        },
        data: {
          status: "FAILED",
          stage: "failed",
          failure: { code },
          ...(partialResult
            ? { resultSummary: json(partialResult) }
            : {}),
          publishingHeartbeatAt: completedAt,
          publishingCompletedAt: completedAt,
          version: { increment: 1 }
        }
      });
      if (changed.count === 0) {
        return {
          importId: semanticImport.id,
          status: "SKIPPED" as const
        };
      }
      await transaction.outboxEvent.create({
        data: {
          eventType: domainEventTypes.semanticImportFailed,
          aggregateId: semanticImport.id,
          workspaceId: semanticImport.workspaceId,
          projectId: semanticImport.projectId,
          payload: {
            importId: semanticImport.id,
            uploadId: semanticImport.uploadId,
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            stage: "publish",
            code,
            partial: Boolean(partialResult)
          },
          metadata: {
            producer: "jobs-integrations",
            source: "semantic-import-worker"
          }
        }
      });
      return {
        importId: semanticImport.id,
        status: "FAILED" as const,
        code
      };
    });
  }

  private async terminateReceipt(
    semanticImport: SemanticImport,
    reason: "CANCELLED" | "FAILED_FINAL"
  ): Promise<SemanticImportResultSummary | undefined> {
    const termination = await this.seoData.abortImport({
      workspaceId: semanticImport.workspaceId,
      projectId: semanticImport.projectId,
      actorId: semanticImport.actorId,
      importId: semanticImport.id,
      reason
    });
    if (termination.status === "ABORTED") return undefined;
    return this.seoData.completeImport({
      workspaceId: semanticImport.workspaceId,
      projectId: semanticImport.projectId,
      actorId: semanticImport.actorId,
      importId: semanticImport.id,
      partial: termination.status !== "COMPLETED"
    });
  }

  private async releaseForRetry(
    importId: string,
    claimedAt: Date
  ): Promise<void> {
    await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        status: "PUBLISHING",
        publishingStartedAt: claimedAt
      },
      data: {
        status: "READY_TO_PUBLISH",
        stage: "publish_retry_pending",
        publishingStartedAt: null,
        publishingHeartbeatAt: null,
        failure: { code: "IMPORT_DEPENDENCY_UNAVAILABLE" },
        version: { increment: 1 }
      }
    });
  }

  private async releaseCancellationForRetry(
    importId: string,
    claimedAt: Date
  ): Promise<void> {
    await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        status: "CANCEL_REQUESTED",
        publishingStartedAt: claimedAt
      },
      data: {
        stage: "cancel_retry_pending",
        publishingStartedAt: null,
        publishingHeartbeatAt: null,
        failure: { code: "IMPORT_DEPENDENCY_UNAVAILABLE" },
        version: { increment: 1 }
      }
    });
  }

  private async heartbeat(
    importId: string,
    claimedAt: Date
  ): Promise<void> {
    const updated = await this.prisma.semanticImport.updateMany({
      where: {
        id: importId,
        status: "PUBLISHING",
        publishingStartedAt: claimedAt
      },
      data: {
        publishingHeartbeatAt: new Date(),
        stage: "publishing_chunks"
      }
    });
    if (updated.count === 0) {
      const current = await this.prisma.semanticImport.findUnique({
        where: { id: importId },
        select: { status: true }
      });
      if (current?.status === "CANCEL_REQUESTED") return;
      throw new Error("Semantic import publishing lease was lost");
    }
  }

  private async cancelRequested(
    importId: string,
    claimedAt: Date
  ): Promise<boolean> {
    const current = await this.prisma.semanticImport.findFirst({
      where: { id: importId, publishingStartedAt: claimedAt },
      select: { status: true }
    });
    if (!current) throw new Error("Semantic import publishing lease was lost");
    return current.status === "CANCEL_REQUESTED";
  }

  private staleBefore(): Date {
    return new Date(
      Date.now() -
        this.config.imports.parseLeaseMinutes * 60 * 1_000
    );
  }
}

export function semanticImportPublishRetryExhausted(
  attempts: number
): boolean {
  return attempts >= SEMANTIC_IMPORT_MAX_PUBLISH_ATTEMPTS;
}

async function validatedBatch(
  prisma: PrismaService,
  importId: string,
  limit: number,
  afterHash: string | undefined,
  createMissingKeywords: boolean
): Promise<
  readonly {
    readonly normalized_hash: string;
    readonly canonical_row?: unknown;
    readonly canonical_rows?: readonly unknown[];
  }[]
> {
  return afterHash
    ? prisma.$queryRaw`
        SELECT
          "normalized_hash",
          jsonb_agg("canonical_row" ORDER BY "row_number") AS "canonical_rows"
        FROM "semantic_import_validated_rows"
        WHERE
          "import_id" = ${importId}::uuid
          AND "is_valid"
          AND (${createMissingKeywords} OR "project_duplicate")
          AND "normalized_hash" > ${afterHash}
        GROUP BY "normalized_hash"
        ORDER BY "normalized_hash"
        LIMIT ${limit}
      `
    : prisma.$queryRaw`
        SELECT
          "normalized_hash",
          jsonb_agg("canonical_row" ORDER BY "row_number") AS "canonical_rows"
        FROM "semantic_import_validated_rows"
        WHERE
          "import_id" = ${importId}::uuid
          AND "is_valid"
          AND (${createMissingKeywords} OR "project_duplicate")
        GROUP BY "normalized_hash"
        ORDER BY "normalized_hash"
        LIMIT ${limit}
      `;
}

export function mergeCanonicalPublishRows(
  rows: readonly SemanticImportPublishRow[]
): SemanticImportPublishRow {
  const first = rows[0]!;
  const groupPaths = uniquePaths(
    rows.flatMap((row) =>
      row.groupPaths ?? (row.groupPath ? [row.groupPath] : [])
    )
  );
  const tags = [...new Set(rows.flatMap((row) => row.tags ?? []))];
  const customValues = Object.assign(
    {},
    ...rows.map(({ customValues }) => customValues)
  ) as Readonly<Record<string, string>>;
  const positions = [...new Map(
    rows.flatMap((row) => row.positions ?? []).map((position) => [
      position.searchEngine,
      position
    ])
  ).values()];

  // Keep the exact field order used by the receiving input canonicalizer.
  // The payload hash is deliberately calculated over canonical JSON, so
  // spreading `first` before appending groupPaths would place groupPaths
  // after customValues and make the integrity check fail for KC4 duplicates.
  return {
    sourceRowNumber: first.sourceRowNumber,
    textOriginal: first.textOriginal,
    textNormalized: first.textNormalized,
    normalizedHash: first.normalizedHash,
    language: first.language,
    ...(first.priority === undefined ? {} : { priority: first.priority }),
    ...(first.isFavorite === undefined
      ? {}
      : { isFavorite: first.isFavorite }),
    ...(first.intent === undefined ? {} : { intent: first.intent }),
    ...(groupPaths.length > 0 ? { groupPaths } : {}),
    ...(first.targetUrl ? { targetUrl: first.targetUrl } : {}),
    ...(first.frequencies ? { frequencies: first.frequencies } : {}),
    ...(positions.length > 0 ? { positions } : {}),
    ...(first.observedAt ? { observedAt: first.observedAt } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    customValues
  };
}

function uniquePaths(
  paths: readonly (readonly string[])[]
): readonly (readonly string[])[] {
  const values = new Map<string, readonly string[]>();
  for (const path of paths) values.set(JSON.stringify(path), path);
  return [...values.values()];
}

export function canonicalPublishRow(
  value: unknown
): SemanticImportPublishRow | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const row = value as Readonly<Record<string, unknown>>;
  const required = [
    "sourceRowNumber",
    "textOriginal",
    "textNormalized",
    "normalizedHash",
    "language"
  ] as const;
  if (
    required.some((field) => typeof row[field] !== "string") ||
    typeof row.customValues !== "object" ||
    row.customValues === null ||
    Array.isArray(row.customValues)
  ) {
    return undefined;
  }
  if (
    Object.values(row.customValues).some(
      (item) => typeof item !== "string"
    ) ||
    (row.targetUrl !== undefined && typeof row.targetUrl !== "string") ||
    (row.observedAt !== undefined && typeof row.observedAt !== "string") ||
    (row.priority !== undefined &&
      (!Number.isSafeInteger(row.priority) ||
        Number(row.priority) < 0 ||
        Number(row.priority) > 100)) ||
    (row.isFavorite !== undefined && typeof row.isFavorite !== "boolean") ||
    (row.intent !== undefined &&
      ![
        "INFORMATIONAL",
        "NAVIGATIONAL",
        "COMMERCIAL",
        "TRANSACTIONAL",
        "LOCAL",
        "MIXED"
      ].includes(String(row.intent)))
  ) {
    return undefined;
  }
  if (
    row.groupPath !== undefined &&
    (!Array.isArray(row.groupPath) ||
      row.groupPath.some((item) => typeof item !== "string"))
  ) {
    return undefined;
  }
  if (
    row.tags !== undefined &&
    (!Array.isArray(row.tags) ||
      row.tags.some((item) => typeof item !== "string"))
  ) {
    return undefined;
  }
  if (
    row.frequencies !== undefined &&
    (!Array.isArray(row.frequencies) ||
      row.frequencies.some(
        (item) =>
          typeof item !== "object" ||
          item === null ||
          !("type" in item) ||
          !["BASE", "EXACT", "FIXED"].includes(String(item.type)) ||
          !("value" in item) ||
          typeof item.value !== "string"
      ))
  ) {
    return undefined;
  }
  if (
    row.positions !== undefined &&
    (!Array.isArray(row.positions) ||
      row.positions.length > 2 ||
      row.positions.some(
        (item) =>
          typeof item !== "object" ||
          item === null ||
          !("searchEngine" in item) ||
          !["YANDEX", "GOOGLE"].includes(String(item.searchEngine)) ||
          !("found" in item) ||
          typeof item.found !== "boolean" ||
          (item.position !== undefined &&
            (!Number.isSafeInteger(item.position) || Number(item.position) < 1)) ||
          (item.previousPosition !== undefined &&
            (!Number.isSafeInteger(item.previousPosition) ||
              Number(item.previousPosition) < 1)) ||
          (item.rankingUrl !== undefined &&
            typeof item.rankingUrl !== "string")
      ))
  ) {
    return undefined;
  }
  const frequencies = row.frequencies
    ? (row.frequencies as readonly Readonly<Record<string, unknown>>[]).map(
        (frequency) => ({
          type: frequency.type as "BASE" | "EXACT" | "FIXED",
          value: frequency.value as string
        })
      )
    : undefined;
  const positions = row.positions
    ? (row.positions as readonly Readonly<Record<string, unknown>>[]).map(
        (position) => ({
          searchEngine: position.searchEngine as "YANDEX" | "GOOGLE",
          found: position.found as boolean,
          ...(position.position === undefined
            ? {}
            : { position: position.position as number }),
          ...(position.previousPosition === undefined
            ? {}
            : { previousPosition: position.previousPosition as number }),
          ...(position.rankingUrl === undefined
            ? {}
            : { rankingUrl: position.rankingUrl as string })
        })
      )
    : undefined;
  return {
    sourceRowNumber: row.sourceRowNumber as string,
    textOriginal: row.textOriginal as string,
    textNormalized: row.textNormalized as string,
    normalizedHash: row.normalizedHash as string,
    language: row.language as string,
    ...(row.priority === undefined ? {} : { priority: row.priority as number }),
    ...(row.isFavorite === undefined
      ? {}
      : { isFavorite: row.isFavorite as boolean }),
    ...(row.intent === undefined
      ? {}
      : {
          intent: row.intent as NonNullable<SemanticImportPublishRow["intent"]>
        }),
    ...(row.groupPath
      ? { groupPath: row.groupPath as readonly string[] }
      : {}),
    ...(row.targetUrl ? { targetUrl: row.targetUrl as string } : {}),
    ...(frequencies ? { frequencies } : {}),
    ...(positions ? { positions } : {}),
    ...(row.observedAt
      ? { observedAt: row.observedAt as string }
      : {}),
    ...(row.tags ? { tags: row.tags as readonly string[] } : {}),
    customValues:
      row.customValues as Readonly<Record<string, string>>
  };
}

function importEntitlement(
  semanticImport: SemanticImport
): SemanticCapacityEntitlement | undefined {
  const {
    billingPlanCode,
    billingPlanVersion,
    storedKeywordsLimit,
    keywordsPerProjectLimit,
    foldersPerProjectLimit,
    trackedContextPairsLimit
  } = semanticImport;
  if (
    !billingPlanCode ||
    billingPlanVersion === null ||
    storedKeywordsLimit === null ||
    keywordsPerProjectLimit === null ||
    foldersPerProjectLimit === null ||
    trackedContextPairsLimit === null
  ) {
    return undefined;
  }
  const storedKeywords = safePlanLimit(storedKeywordsLimit);
  const keywordsPerProject = safePlanLimit(
    keywordsPerProjectLimit
  );
  const trackedContextPairs = safePlanLimit(
    trackedContextPairsLimit
  );
  const foldersPerProject = safeNonNegativePlanLimit(
    foldersPerProjectLimit
  );
  if (
    !Number.isSafeInteger(billingPlanVersion) ||
    billingPlanVersion <= 0 ||
    storedKeywords === undefined ||
    keywordsPerProject === undefined ||
    foldersPerProject === undefined ||
    trackedContextPairs === undefined
  ) {
    return undefined;
  }
  return {
    planCode: billingPlanCode,
    planVersion: billingPlanVersion,
    storedKeywords,
    keywordsPerProject,
    foldersPerProject,
    trackedContextPairs
  };
}

function safeNonNegativePlanLimit(value: bigint): number | undefined {
  return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : undefined;
}

function safePlanLimit(value: bigint): number | undefined {
  return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : undefined;
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function safeKc4GroupPaths(
  value: unknown
): readonly (readonly string[])[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const groupPaths = (value as Readonly<Record<string, unknown>>).groupPaths;
  if (!Array.isArray(groupPaths) || groupPaths.length > 2_000) {
    return undefined;
  }
  const parsed = groupPaths.map((path) => {
    if (
      !Array.isArray(path) ||
      path.length < 1 ||
      path.length > semanticImportMaxGroupDepth ||
      path.some(
        (segment) =>
          typeof segment !== "string" ||
          segment.length < 1 ||
          segment.length > 255
      )
    ) {
      throw new Error("Stored KC4 group manifest is invalid");
    }
    return path as readonly string[];
  });
  return parsed.length > 0 ? parsed : undefined;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
