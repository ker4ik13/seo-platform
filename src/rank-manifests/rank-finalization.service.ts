import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  InternalFinalizeRankCheckInput,
  InternalRankCheckFinalizationReceipt,
  RankCheckFinalStatus,
  RankManifestHash
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

const FINALIZE_SCHEMA = "rank-finalize@1";
const FINALIZATION_TRANSACTION_MAX_WAIT_MS = 5_000;
const FINALIZATION_TRANSACTION_TIMEOUT_MS = 15_000;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ZERO_RESULT_FINAL_STATUSES =
  new Set<RankCheckFinalStatus>([
    "CANCELLED",
    "FAILED",
    "ACTION_REQUIRED"
  ]);

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

@Injectable()
export class RankFinalizationService {
  public constructor(private readonly prisma: PrismaService) {}

  public async finalize(
    input: InternalFinalizeRankCheckInput
  ): Promise<InternalRankCheckFinalizationReceipt> {
    if (!ZERO_RESULT_FINAL_STATUSES.has(input.status)) {
      finalizationConflict(
        "RANK_INGEST_NOT_READY",
        "Result-bearing rank finalization requires ingest receipts"
      );
    }
    const requestHash = finalizationRequestHash(input);
    return this.prisma.$transaction(
      async (transaction) => {
        const manifest = await lockManifest(transaction, input);
        if (!manifest) {
          throw new NotFoundException("Rank execution manifest not found");
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
              persistedCount: 0,
              foundCount: 0,
              notFoundCount: 0,
              missingCount: manifest.pairCount,
              finalizedAt
            },
            select: FINALIZATION_RECEIPT_SELECT
          });
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
    !ZERO_RESULT_FINAL_STATUSES.has(record.status) ||
    record.persistedCount !== 0 ||
    record.foundCount !== 0 ||
    record.notFoundCount !== 0 ||
    record.missingCount !== record.pairCount ||
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
    persistedCount: "0",
    foundCount: "0",
    notFoundCount: "0",
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
    manifest.pairCount > 1_000 ||
    !(manifest.sealedAt instanceof Date) ||
    Number.isNaN(manifest.sealedAt.getTime()) ||
    !(manifest.finalizedAt instanceof Date) ||
    Number.isNaN(manifest.finalizedAt.getTime()) ||
    manifest.finalizedAt.getTime() < manifest.sealedAt.getTime()
  ) {
    throw new Error("Stored rank execution manifest lock is invalid");
  }
}

function finalizationRequestHash(
  input: InternalFinalizeRankCheckInput
): Buffer {
  // actorId is audit provenance of the first write, not part of the
  // job+manifest+status idempotency identity defined by the contract.
  return Buffer.from(
    canonicalJsonSha256(FINALIZE_SCHEMA, {
      schemaVersion: input.schemaVersion,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      jobId: input.jobId,
      manifestId: input.manifestId,
      status: input.status
    }),
    "hex"
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
