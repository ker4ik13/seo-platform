import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import {
  domainEventTypes,
  rankCheckCompletedEventDataV1,
  rankCommandKeywordLimit,
  type InternalFinalizeRankCheckInput,
  type InternalRankCheckFinalizationReceipt,
  type RankCheckFinalStatus,
  type RankManifestHash
} from "@seo-platform/contracts";
import { rankCheckFinalizationHash } from "@seo-platform/contracts/rank-results-canonical";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { KeywordService } from "../keywords/keyword.service.js";

const FINALIZE_SCHEMA = "rank-finalize@1";
const FINALIZATION_TRANSACTION_MAX_WAIT_MS = 5_000;
const FINALIZATION_TRANSACTION_TIMEOUT_MS = 60_000;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const FINALIZATION_RECEIPT_SELECT = {
  manifestId: true,
  workspaceId: true,
  projectId: true,
  jobId: true,
  finalizedBy: true,
  schemaVersion: true,
  requestHash: true,
  trackingContextId: true,
  configurationVersion: true,
  status: true,
  pairCount: true,
  persistedCount: true,
  foundCount: true,
  notFoundCount: true,
  missingCount: true,
  finalizedAt: true
} satisfies Prisma.RankCheckFinalizationReceiptSelect;

type FinalizationReceiptRecord =
  Prisma.RankCheckFinalizationReceiptGetPayload<{
    select: typeof FINALIZATION_RECEIPT_SELECT;
  }>;

interface LockedManifest {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly trackingContextId: string;
  readonly configurationVersion: number;
  readonly pairCount: number;
  readonly status: "BUILDING" | "SEALED" | "CLOSED";
  readonly sealedAt: Date;
  readonly closedAt: Date | null;
  readonly finalizedAt: Date;
}

interface IngestAggregate {
  readonly persistedCount: number;
  readonly foundCount: number;
  readonly notFoundCount: number;
}

@Injectable()
export class RankFinalizationService {
  private readonly logger = new Logger(RankFinalizationService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly keywords?: KeywordService
  ) {}

  public async finalize(
    input: InternalFinalizeRankCheckInput
  ): Promise<InternalRankCheckFinalizationReceipt> {
    const requestHash = hashBytes(rankCheckFinalizationHash(input));
    const receipt = await this.prisma.$transaction(
      async (transaction) => {
        const manifest = await lockManifest(transaction, input);
        if (!manifest) {
          throw new NotFoundException(
            "Rank execution manifest not found"
          );
        }
        assertLockedManifest(manifest);
        const existing =
          await transaction.rankCheckFinalizationReceipt.findUnique({
            where: { manifestId: input.manifestId },
            select: FINALIZATION_RECEIPT_SELECT
          });
        if (existing) {
          return storedFinalizationReceipt(
            existing,
            manifest,
            requestHash
          );
        }
        if (manifest.status === "CLOSED") {
          throw new Error(
            "Closed rank execution manifest has no finalization receipt"
          );
        }
        if (manifest.status !== "SEALED" || manifest.closedAt !== null) {
          finalizationConflict(
            "RANK_MANIFEST_NOT_SEALED",
            "Rank execution manifest is not ready for finalization"
          );
        }

        const aggregate = await aggregateIngestReceipts(
          transaction,
          input
        );
        assertFinalizationOutcome(
          input.status,
          manifest.pairCount,
          aggregate.persistedCount
        );
        const finalizedAt = manifest.finalizedAt;
        await transaction.rankExecutionManifest.update({
          where: { id: manifest.id },
          data: {
            status: "CLOSED",
            closedAt: finalizedAt
          }
        });
        const created =
          await transaction.rankCheckFinalizationReceipt.create({
            data: {
              manifestId: manifest.id,
              workspaceId: manifest.workspaceId,
              projectId: manifest.projectId,
              jobId: manifest.jobId,
              finalizedBy: input.actorId,
              schemaVersion: FINALIZE_SCHEMA,
              requestHash: databaseBytes(requestHash),
              trackingContextId: manifest.trackingContextId,
              configurationVersion: manifest.configurationVersion,
              status: input.status,
              pairCount: manifest.pairCount,
              persistedCount: aggregate.persistedCount,
              foundCount: aggregate.foundCount,
              notFoundCount: aggregate.notFoundCount,
              missingCount:
                manifest.pairCount - aggregate.persistedCount,
              finalizedAt
            },
            select: FINALIZATION_RECEIPT_SELECT
          });
        await emitCompletionEvent(
          transaction,
          input.status,
          manifest,
          aggregate,
          finalizedAt
        );
        return storedFinalizationReceipt(
          created,
          {
            ...manifest,
            status: "CLOSED",
            closedAt: finalizedAt
          },
          requestHash
        );
      },
      {
        isolationLevel: "ReadCommitted",
        maxWait: FINALIZATION_TRANSACTION_MAX_WAIT_MS,
        timeout: FINALIZATION_TRANSACTION_TIMEOUT_MS
      }
    );
    if (this.keywords) {
      void this.keywords
        .warmPositionHistory(input.workspaceId, input.projectId)
        .catch(() => {
          this.logger.warn({
            event: "position_history_projection_warm_failed",
            source: "rank_finalization",
            projectId: input.projectId
          });
        });
    }
    return receipt;
  }
}

async function lockManifest(
  transaction: Prisma.TransactionClient,
  input: InternalFinalizeRankCheckInput
): Promise<LockedManifest | undefined> {
  const rows = await transaction.$queryRaw<LockedManifest[]>`
    SELECT
      "id"::text AS "id",
      "workspace_id"::text AS "workspaceId",
      "project_id"::text AS "projectId",
      "job_id"::text AS "jobId",
      "tracking_context_id"::text AS "trackingContextId",
      "configuration_version" AS "configurationVersion",
      "pair_count" AS "pairCount",
      "status"::text AS "status",
      "sealed_at" AS "sealedAt",
      "closed_at" AS "closedAt",
      GREATEST(clock_timestamp(), "sealed_at") AS "finalizedAt"
    FROM "rank_execution_manifests"
    WHERE "workspace_id" = ${input.workspaceId}::uuid
      AND "project_id" = ${input.projectId}::uuid
      AND "id" = ${input.manifestId}::uuid
      AND "job_id" = ${input.jobId}::uuid
    FOR UPDATE
  `;
  if (rows.length > 1) {
    throw new Error("Rank execution manifest scope is not unique");
  }
  return rows[0];
}

async function aggregateIngestReceipts(
  transaction: Prisma.TransactionClient,
  input: InternalFinalizeRankCheckInput
): Promise<IngestAggregate> {
  const aggregate = await transaction.rankChunkIngestReceipt.aggregate({
    where: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      manifestId: input.manifestId,
      jobId: input.jobId
    },
    _sum: {
      persistedCount: true,
      foundCount: true,
      notFoundCount: true
    }
  });
  const result: IngestAggregate = {
    persistedCount: aggregate._sum.persistedCount ?? 0,
    foundCount: aggregate._sum.foundCount ?? 0,
    notFoundCount: aggregate._sum.notFoundCount ?? 0
  };
  if (
    !validCount(
      result.persistedCount,
      0,
      rankCommandKeywordLimit
    ) ||
    !validCount(result.foundCount, 0, result.persistedCount) ||
    !validCount(result.notFoundCount, 0, result.persistedCount) ||
    result.persistedCount !==
      result.foundCount + result.notFoundCount
  ) {
    throw new Error("Stored rank ingest aggregates are invalid");
  }
  return result;
}

async function emitCompletionEvent(
  transaction: Prisma.TransactionClient,
  status: RankCheckFinalStatus,
  manifest: LockedManifest,
  aggregate: IngestAggregate,
  finalizedAt: Date
): Promise<void> {
  if (status !== "COMPLETED" && status !== "PARTIALLY_COMPLETED") {
    return;
  }
  const payload = rankCheckCompletedEventDataV1({
    jobId: manifest.jobId,
    manifestId: manifest.id,
    workspaceId: manifest.workspaceId,
    projectId: manifest.projectId,
    trackingContextId: manifest.trackingContextId,
    configurationVersion: manifest.configurationVersion,
    status,
    pairCount: String(manifest.pairCount),
    persistedCount: String(aggregate.persistedCount),
    foundCount: String(aggregate.foundCount),
    notFoundCount: String(aggregate.notFoundCount),
    completedAt: finalizedAt
  });
  await transaction.outboxEvent.create({
    data: {
      eventType: domainEventTypes.rankCheckCompleted,
      aggregateId: manifest.id,
      workspaceId: manifest.workspaceId,
      projectId: manifest.projectId,
      payload: { ...payload },
      metadata: {
        producer: "seo-data",
        source: "rank-results"
      }
    }
  });
}

function storedFinalizationReceipt(
  record: FinalizationReceiptRecord,
  manifest: LockedManifest,
  expectedRequestHash: Buffer
): InternalRankCheckFinalizationReceipt {
  const storedRequestHash = Buffer.from(record.requestHash);
  const finalizedAtValid =
    record.finalizedAt instanceof Date &&
    !Number.isNaN(record.finalizedAt.getTime());
  if (
    record.schemaVersion !== FINALIZE_SCHEMA ||
    !UUID_PATTERN.test(record.manifestId) ||
    !UUID_PATTERN.test(record.workspaceId) ||
    !UUID_PATTERN.test(record.projectId) ||
    !UUID_PATTERN.test(record.jobId) ||
    !UUID_PATTERN.test(record.finalizedBy) ||
    !UUID_PATTERN.test(record.trackingContextId) ||
    record.manifestId !== manifest.id ||
    record.workspaceId !== manifest.workspaceId ||
    record.projectId !== manifest.projectId ||
    record.jobId !== manifest.jobId ||
    record.trackingContextId !== manifest.trackingContextId ||
    record.configurationVersion !== manifest.configurationVersion ||
    record.pairCount !== manifest.pairCount ||
    !validCount(record.persistedCount, 0, record.pairCount) ||
    !validCount(record.foundCount, 0, record.persistedCount) ||
    !validCount(record.notFoundCount, 0, record.persistedCount) ||
    record.persistedCount !==
      record.foundCount + record.notFoundCount ||
    record.missingCount !==
      record.pairCount - record.persistedCount ||
    !finalizationOutcomeIsValid(
      record.status,
      record.pairCount,
      record.persistedCount
    ) ||
    manifest.status !== "CLOSED" ||
    !(manifest.closedAt instanceof Date) ||
    Number.isNaN(manifest.closedAt.getTime()) ||
    !finalizedAtValid ||
    manifest.closedAt.getTime() !== record.finalizedAt.getTime()
  ) {
    throw new Error("Stored rank finalization receipt is invalid");
  }
  if (
    storedRequestHash.length !== 32 ||
    expectedRequestHash.length !== 32
  ) {
    throw new Error("Stored rank finalization request hash is invalid");
  }
  if (!timingSafeEqual(storedRequestHash, expectedRequestHash)) {
    finalizationConflict(
      "RANK_FINALIZATION_CONFLICT",
      "Rank execution manifest is already finalized with another status"
    );
  }
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    jobId: record.jobId,
    manifestId: record.manifestId,
    requestHash: hashFromBytes(record.requestHash),
    trackingContextId: record.trackingContextId,
    configurationVersion: record.configurationVersion,
    status: record.status,
    pairCount: String(record.pairCount),
    persistedCount: String(record.persistedCount),
    foundCount: String(record.foundCount),
    notFoundCount: String(record.notFoundCount),
    missingCount: String(record.missingCount),
    finalizedAt: record.finalizedAt.toISOString()
  };
}

function assertLockedManifest(manifest: LockedManifest): void {
  if (
    !UUID_PATTERN.test(manifest.id) ||
    !UUID_PATTERN.test(manifest.workspaceId) ||
    !UUID_PATTERN.test(manifest.projectId) ||
    !UUID_PATTERN.test(manifest.jobId) ||
    !UUID_PATTERN.test(manifest.trackingContextId) ||
    !Number.isSafeInteger(manifest.configurationVersion) ||
    manifest.configurationVersion < 1 ||
    !Number.isSafeInteger(manifest.pairCount) ||
    manifest.pairCount < 1 ||
    manifest.pairCount > rankCommandKeywordLimit ||
    !(manifest.sealedAt instanceof Date) ||
    Number.isNaN(manifest.sealedAt.getTime()) ||
    !(manifest.finalizedAt instanceof Date) ||
    Number.isNaN(manifest.finalizedAt.getTime()) ||
    manifest.finalizedAt.getTime() < manifest.sealedAt.getTime()
  ) {
    throw new Error("Stored rank execution manifest lock is invalid");
  }
}

function assertFinalizationOutcome(
  status: RankCheckFinalStatus,
  pairCount: number,
  persistedCount: number
): void {
  if (!finalizationOutcomeIsValid(status, pairCount, persistedCount)) {
    finalizationConflict(
      "RANK_FINALIZATION_OUTCOME_CONFLICT",
      "Rank finalization status does not match persisted results"
    );
  }
}

function finalizationOutcomeIsValid(
  status: RankCheckFinalStatus,
  pairCount: number,
  persistedCount: number
): boolean {
  if (
    !validCount(pairCount, 1, rankCommandKeywordLimit) ||
    !validCount(persistedCount, 0, pairCount)
  ) {
    return false;
  }
  switch (status) {
    case "COMPLETED":
      return persistedCount === pairCount;
    case "PARTIALLY_COMPLETED":
      return persistedCount > 0 && persistedCount < pairCount;
    case "CANCELLED":
      return true;
    case "FAILED":
      return persistedCount === 0;
    case "ACTION_REQUIRED":
      return persistedCount < pairCount;
  }
}

function validCount(
  value: number,
  minimum: number,
  maximum: number
): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function hashFromBytes(value: Uint8Array): RankManifestHash {
  const bytes = Buffer.from(value);
  if (
    bytes.length !== 32 ||
    !HASH_PATTERN.test(bytes.toString("hex"))
  ) {
    throw new Error("Stored rank finalization request hash is invalid");
  }
  return {
    algorithm: "SHA_256",
    value: bytes.toString("hex")
  };
}

function hashBytes(hash: RankManifestHash): Buffer {
  if (
    hash.algorithm !== "SHA_256" ||
    !HASH_PATTERN.test(hash.value)
  ) {
    throw new TypeError("Invalid rank finalization hash");
  }
  return Buffer.from(hash.value, "hex");
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function finalizationConflict(code: string, message: string): never {
  throw new HttpException(
    {
      error: {
        code,
        message
      }
    },
    HttpStatus.CONFLICT
  );
}
