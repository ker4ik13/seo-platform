import { createHash } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  domainEventTypes,
  type InternalSemanticImportReceipt,
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
  readonly batchSize: number;
  readonly expectedChunks: number;
}

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
        return this.fail(
          semanticImport,
          claimedAt,
          "SEO_DATA_PUBLISH_REJECTED"
        );
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
          claimedAt,
          chunkIndex
        );
      }
      const batch = await validatedBatch(
        this.prisma,
        semanticImport.id,
        batchSize,
        afterHash
      );
      if (batch.length === 0) break;
      const rows = batch.map(({ canonical_row }) => {
        const row = safePublishRow(canonical_row);
        if (!row) throw new Error("Validated semantic row is invalid");
        return row;
      });
      const payloadHash = hashJson(rows);
      await this.seoData.applyChunk({
        workspaceId: semanticImport.workspaceId,
        projectId: semanticImport.projectId,
        actorId: semanticImport.actorId,
        importId: semanticImport.id,
        chunkIndex,
        payloadHash,
        duplicatePolicy: mapping.duplicatePolicy,
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
    const plan = this.publishPlan(semanticImport);
    if ("code" in plan) {
      return this.finishCancelled(semanticImport, claimedAt, 0);
    }
    const receipt = await this.beginReceipt(semanticImport, plan);
    return this.finishCancelled(
      semanticImport,
      claimedAt,
      receipt.receivedChunks
    );
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
    return {
      mapping,
      uniqueRows,
      batchSize,
      expectedChunks: Number(expectedChunksBig)
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
      expectedChunks: plan.expectedChunks,
      expectedUniqueRows: plan.uniqueRows.toString()
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
          payload: {
            importId: semanticImport.id,
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            ...result
          },
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
    claimedAt: Date,
    processedChunks: number
  ): Promise<SemanticImportPublishOutcome> {
    const result =
      processedChunks > 0
        ? await this.seoData.completeImport({
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            actorId: semanticImport.actorId,
            importId: semanticImport.id,
            partial: true
          })
        : undefined;
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
          payload: {
            importId: semanticImport.id,
            workspaceId: semanticImport.workspaceId,
            projectId: semanticImport.projectId,
            partial: Boolean(result),
            ...result
          },
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
            code
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

async function validatedBatch(
  prisma: PrismaService,
  importId: string,
  limit: number,
  afterHash: string | undefined
): Promise<
  readonly {
    readonly normalized_hash: string;
    readonly canonical_row: unknown;
  }[]
> {
  return afterHash
    ? prisma.$queryRaw`
        SELECT DISTINCT ON ("normalized_hash")
          "normalized_hash",
          "canonical_row"
        FROM "semantic_import_validated_rows"
        WHERE
          "import_id" = ${importId}::uuid
          AND "is_valid"
          AND "normalized_hash" > ${afterHash}
        ORDER BY "normalized_hash", "row_number"
        LIMIT ${limit}
      `
    : prisma.$queryRaw`
        SELECT DISTINCT ON ("normalized_hash")
          "normalized_hash",
          "canonical_row"
        FROM "semantic_import_validated_rows"
        WHERE
          "import_id" = ${importId}::uuid
          AND "is_valid"
        ORDER BY "normalized_hash", "row_number"
        LIMIT ${limit}
      `;
}

function safePublishRow(value: unknown): SemanticImportPublishRow | undefined {
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
  return value as SemanticImportPublishRow;
}

function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
