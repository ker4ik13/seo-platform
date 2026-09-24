import { rankManifestShapeIsSupported } from "@seo-platform/contracts";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  rankCommandKeywordLimit,
  rankExecutionPurpose,
  rankExecutionTracksProjectPosition,
  rankManifestChunkHashPreimage,
  type InternalIngestRankChunkInput,
  type InternalNormalizedRankResult,
  type InternalRankChunkIngestCommand,
  type InternalRankChunkIngestReceipt,
  type InternalRankManifestChunk,
  type InternalRankManifestEntry,
  type InternalRankExecutionParameters,
  type RankManifestHash
} from "@seo-platform/contracts";
import {
  rankChunkIngestHash,
  rankChunkIngestHashPreimage
} from "@seo-platform/contracts/rank-results-canonical";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { rankExecutionParameters } from "../rank-manifests/rank-manifest-input.js";

const INGEST_SCHEMA = "rank-ingest@1";
const CHUNK_SCHEMA = "rank-manifest-chunk@1";
const RESULT_TRANSACTION_MAX_WAIT_MS = 5_000;
const RESULT_TRANSACTION_TIMEOUT_MS = 120_000;
const RANK_SNAPSHOT_INSERT_BATCH_SIZE = 1_000;
const RANK_SERP_RESULT_INSERT_BATCH_SIZE = 5_000;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

const RECEIPT_SELECT = {
  manifestId: true,
  chunkIndex: true,
  workspaceId: true,
  projectId: true,
  jobId: true,
  jobItemId: true,
  ingestedBy: true,
  schemaVersion: true,
  ingestEnvelopeHash: true,
  manifestChunkHash: true,
  provider: true,
  operation: true,
  providerRequestId: true,
  connectorVersion: true,
  observedAt: true,
  status: true,
  persistedCount: true,
  foundCount: true,
  notFoundCount: true,
  currentUpdatedCount: true,
  currentSkippedCount: true,
  appliedAt: true
} satisfies Prisma.RankChunkIngestReceiptSelect;

const ENTRY_SELECT = {
  id: true,
  sequence: true,
  assignmentId: true,
  keywordId: true,
  keywordVersion: true,
  keywordText: true,
  keywordTextHash: true,
  language: true
} satisfies Prisma.RankExecutionManifestEntrySelect;

type ReceiptRecord = Prisma.RankChunkIngestReceiptGetPayload<{
  select: typeof RECEIPT_SELECT;
}>;

interface LockedManifest {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly trackingContextId: string;
  readonly configurationVersion: number;
  readonly provider: string;
  readonly operation: string;
  readonly execution: Prisma.JsonValue;
  readonly pairCount: number;
  readonly chunkCount: number;
  readonly chunkSize: number;
  readonly status: "BUILDING" | "SEALED" | "CLOSED";
  readonly appliedAt: Date;
}

interface LockedChunk {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly manifestId: string;
  readonly chunkIndex: number;
  readonly hashSchemaVersion: string;
  readonly chunkHash: Uint8Array;
  readonly entryCount: number;
}

interface SnapshotAllocation {
  readonly ids: readonly string[];
}

interface CurrentProjectionInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly keywordId: string;
  readonly trackingContextId: string;
  readonly configurationVersion: number;
  readonly observedAt: string;
  readonly snapshotId: string;
  readonly found: boolean;
  readonly position: number | null;
  readonly rankingUrl: string | null;
  readonly normalizedRankingUrl: string | null;
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  readonly sourceMode: "BYOK";
  readonly dataQualityFlags: readonly string[];
  readonly updatedAt: string;
}

@Injectable()
export class RankResultService {
  public constructor(private readonly prisma: PrismaService) {}

  public async ingest(
    input: InternalIngestRankChunkInput
  ): Promise<InternalRankChunkIngestReceipt> {
    return this.prisma.$transaction(
      async (transaction) => {
        const manifest = await lockManifest(transaction, input);
        if (!manifest) {
          throw new NotFoundException(
            "Rank execution manifest not found"
          );
        }
        assertManifest(manifest, input);
        const execution = storedManifestExecution(manifest.execution);
        const chunk = await lockChunk(transaction, input);
        if (!chunk) {
          throw new NotFoundException("Rank manifest chunk not found");
        }
        const entries =
          await transaction.rankExecutionManifestEntry.findMany({
            where: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              manifestId: input.manifestId,
              chunkIndex: input.chunkIndex
            },
            orderBy: { sequence: "asc" },
            select: ENTRY_SELECT
          });
        const sealedChunk = storedSealedChunk(
          manifest,
          chunk,
          entries
        );
        const command = ingestCommand(input);
        const { canonicalCommand, expectedHash } =
          canonicalIngest(command, sealedChunk);
        assertHashMatches(
          input.ingestEnvelopeHash,
          expectedHash,
          "RANK_INGEST_HASH_MISMATCH"
        );

        const existing =
          await transaction.rankChunkIngestReceipt.findUnique({
            where: {
              manifestId_chunkIndex: {
                manifestId: input.manifestId,
                chunkIndex: input.chunkIndex
              }
            },
            select: RECEIPT_SELECT
          });
        if (existing) {
          return storedReceipt(existing, input.ingestEnvelopeHash);
        }
        if (manifest.status === "CLOSED") {
          resultConflict(
            "RANK_MANIFEST_CLOSED",
            "Rank execution manifest no longer accepts results"
          );
        }
        if (manifest.status !== "SEALED") {
          resultConflict(
            "RANK_MANIFEST_NOT_SEALED",
            "Rank execution manifest is not ready for results"
          );
        }

        const reusedJobItem =
          await transaction.rankChunkIngestReceipt.findFirst({
            where: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              jobItemId: input.jobItemId
            },
            select: {
              manifestId: true,
              chunkIndex: true
            }
          });
        if (reusedJobItem) {
          resultConflict(
            "RANK_JOB_ITEM_CONFLICT",
            "Rank job item is already bound to another result chunk"
          );
        }

        const allocation = await allocateSnapshotIds(
          transaction,
          canonicalCommand.results.length
        );
        const observedAt = new Date(canonicalCommand.observedAt);
        const snapshots = canonicalCommand.results.map(
          (result, index) => {
            const entry = entries[index];
            const snapshotId = allocation.ids[index];
            if (!entry || !snapshotId) {
              throw new Error(
                "Normalized rank result allocation is incomplete"
              );
            }
            return snapshotCreateData(
              manifest,
              canonicalCommand,
              entry,
              result,
              snapshotId,
              observedAt,
              positionTrackingEnabled(execution, result)
            );
          }
        );
        for (
          let offset = 0;
          offset < snapshots.length;
          offset += RANK_SNAPSHOT_INSERT_BATCH_SIZE
        ) {
          const batch = snapshots.slice(
            offset,
            offset + RANK_SNAPSHOT_INSERT_BATCH_SIZE
          );
          const inserted = await transaction.rankSnapshot.createMany({
            data: batch
          });
          if (inserted.count !== batch.length) {
            throw new Error(
              "Rank snapshot batch was not fully persisted"
            );
          }
        }

        const serpResults = canonicalCommand.results.flatMap(
          (result, index) => {
            const snapshotId = allocation.ids[index];
            if (!snapshotId) {
              throw new Error(
                "Normalized rank SERP result allocation is incomplete"
              );
            }
            return (result.serpResults ?? []).map((serpResult) => ({
              snapshotObservedAt: observedAt,
              snapshotId,
              position: serpResult.position,
              rankingUrl: serpResult.rankingUrl,
              normalizedRankingUrl: serpResult.normalizedRankingUrl,
              ...(serpResult.faviconUrl === undefined
                ? {}
                : { faviconUrl: serpResult.faviconUrl }),
              ...(serpResult.title === undefined
                ? {}
                : { title: serpResult.title }),
              ...(serpResult.snippet === undefined
                ? {}
                : { snippet: serpResult.snippet }),
              createdAt: manifest.appliedAt
            })) satisfies Prisma.RankSerpResultCreateManyInput[];
          }
        );
        if (serpResults.length > 0) {
          for (
            let offset = 0;
            offset < serpResults.length;
            offset += RANK_SERP_RESULT_INSERT_BATCH_SIZE
          ) {
            const batch = serpResults.slice(
              offset,
              offset + RANK_SERP_RESULT_INSERT_BATCH_SIZE
            );
            const inserted = await transaction.rankSerpResult.createMany({
              data: batch
            });
            if (inserted.count !== batch.length) {
              throw new Error(
                "Rank SERP result batch was not fully persisted"
              );
            }
          }
        }

        const currentUpdatedCount = await upsertCurrentRanks(
          transaction,
          snapshots
            .filter(
              (snapshot) => snapshot.positionTrackingEnabled === true
            )
            .map((snapshot) => currentProjectionInput(
              snapshot,
              manifest.appliedAt
            ))
        );
        const persistedCount = snapshots.length;
        const foundCount = canonicalCommand.results.filter(
          (result) => result.found
        ).length;
        const notFoundCount = persistedCount - foundCount;
        const created =
          await transaction.rankChunkIngestReceipt.create({
            data: {
              manifestId: input.manifestId,
              chunkIndex: input.chunkIndex,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              jobId: input.jobId,
              jobItemId: input.jobItemId,
              ingestedBy: input.actorId,
              schemaVersion: INGEST_SCHEMA,
              ingestEnvelopeHash: hashBytes(expectedHash),
              manifestChunkHash: hashBytes(
                canonicalCommand.manifestChunkHash
              ),
              provider: canonicalCommand.provider,
              operation: canonicalCommand.operation,
              providerRequestId:
                canonicalCommand.providerRequestId,
              connectorVersion: canonicalCommand.connectorVersion,
              observedAt,
              status: "APPLIED",
              persistedCount,
              foundCount,
              notFoundCount,
              currentUpdatedCount,
              currentSkippedCount:
                persistedCount - currentUpdatedCount,
              appliedAt: manifest.appliedAt
            },
            select: RECEIPT_SELECT
          });
        return storedReceipt(created, expectedHash);
      },
      {
        isolationLevel: "ReadCommitted",
        maxWait: RESULT_TRANSACTION_MAX_WAIT_MS,
        timeout: RESULT_TRANSACTION_TIMEOUT_MS
      }
    );
  }
}

function canonicalIngest(
  command: InternalRankChunkIngestCommand,
  sealedChunk: InternalRankManifestChunk
): {
  readonly canonicalCommand: InternalRankChunkIngestCommand;
  readonly expectedHash: RankManifestHash;
} {
  try {
    return {
      canonicalCommand: rankChunkIngestHashPreimage(
        command,
        sealedChunk
      ),
      expectedHash: rankChunkIngestHash(command, sealedChunk)
    };
  } catch (error) {
    if (error instanceof TypeError) {
      resultConflict(
        "RANK_INGEST_SCOPE_MISMATCH",
        "Normalized results do not match the sealed manifest chunk"
      );
    }
    throw error;
  }
}

async function lockManifest(
  transaction: Prisma.TransactionClient,
  input: InternalIngestRankChunkInput
): Promise<LockedManifest | undefined> {
  const rows = await transaction.$queryRaw<LockedManifest[]>`
    SELECT
      "id"::text AS "id",
      "workspace_id"::text AS "workspaceId",
      "project_id"::text AS "projectId",
      "job_id"::text AS "jobId",
      "tracking_context_id"::text AS "trackingContextId",
      "configuration_version" AS "configurationVersion",
      "provider",
      "operation",
      "execution",
      "pair_count" AS "pairCount",
      "chunk_count" AS "chunkCount",
      "chunk_size" AS "chunkSize",
      "status"::text AS "status",
      clock_timestamp() AS "appliedAt"
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

async function lockChunk(
  transaction: Prisma.TransactionClient,
  input: InternalIngestRankChunkInput
): Promise<LockedChunk | undefined> {
  const rows = await transaction.$queryRaw<LockedChunk[]>`
    SELECT
      "workspace_id"::text AS "workspaceId",
      "project_id"::text AS "projectId",
      "manifest_id"::text AS "manifestId",
      "chunk_index" AS "chunkIndex",
      "hash_schema_version" AS "hashSchemaVersion",
      "chunk_hash" AS "chunkHash",
      "entry_count" AS "entryCount"
    FROM "rank_execution_manifest_chunks"
    WHERE "workspace_id" = ${input.workspaceId}::uuid
      AND "project_id" = ${input.projectId}::uuid
      AND "manifest_id" = ${input.manifestId}::uuid
      AND "chunk_index" = ${input.chunkIndex}
    FOR UPDATE
  `;
  if (rows.length > 1) {
    throw new Error("Rank execution manifest chunk is not unique");
  }
  return rows[0];
}

function assertManifest(
  manifest: LockedManifest,
  input: InternalIngestRankChunkInput
): void {
  if (
    !UUID_V7_PATTERN.test(manifest.id) ||
    !UUID_V7_PATTERN.test(manifest.workspaceId) ||
    !UUID_V7_PATTERN.test(manifest.projectId) ||
    !UUID_V7_PATTERN.test(manifest.jobId) ||
    !UUID_V7_PATTERN.test(manifest.trackingContextId) ||
    manifest.id !== input.manifestId ||
    manifest.workspaceId !== input.workspaceId ||
    manifest.projectId !== input.projectId ||
    manifest.jobId !== input.jobId ||
    manifest.provider !== input.provider ||
    (manifest.provider !== "ARSENKIN" && manifest.provider !== "XMLSTOCK") ||
    manifest.operation !== "POSITIONS" ||
    !Number.isSafeInteger(manifest.configurationVersion) ||
    manifest.configurationVersion < 1 ||
    !Number.isSafeInteger(manifest.pairCount) ||
    manifest.pairCount < 1 ||
    !validManifestShape(manifest) ||
    input.chunkIndex >= manifest.chunkCount ||
    !(manifest.appliedAt instanceof Date) ||
    Number.isNaN(manifest.appliedAt.getTime())
  ) {
    throw new Error("Stored rank execution manifest is invalid");
  }
}

function validManifestShape(manifest: LockedManifest): boolean {
  return (manifest.provider === "ARSENKIN" || manifest.provider === "XMLSTOCK") && rankManifestShapeIsSupported(manifest.provider, manifest.pairCount, manifest.chunkCount, manifest.chunkSize);
}

function storedSealedChunk(
  manifest: LockedManifest,
  chunk: LockedChunk,
  entries: readonly Prisma.RankExecutionManifestEntryGetPayload<{
    select: typeof ENTRY_SELECT;
  }>[]
): InternalRankManifestChunk {
  if (
    chunk.workspaceId !== manifest.workspaceId ||
    chunk.projectId !== manifest.projectId ||
    chunk.manifestId !== manifest.id ||
    chunk.chunkIndex < 0 ||
    chunk.chunkIndex >= manifest.chunkCount ||
    chunk.hashSchemaVersion !== CHUNK_SCHEMA ||
    chunk.entryCount !== entries.length ||
    entries.length < 1 ||
    entries.length > manifest.chunkSize
  ) {
    throw new Error("Stored rank manifest chunk is invalid");
  }
  const publicEntries = entries.map((entry, offset) => {
    const expectedSequence = chunk.chunkIndex * manifest.chunkSize + offset;
    if (
      entry.sequence !== expectedSequence ||
      !UUID_V7_PATTERN.test(entry.id) ||
      !UUID_V7_PATTERN.test(entry.assignmentId) ||
      !UUID_V7_PATTERN.test(entry.keywordId) ||
      entry.keywordVersion < 1 ||
      !entry.keywordText ||
      !entry.language
    ) {
      throw new Error("Stored rank manifest entry is invalid");
    }
    const result: InternalRankManifestEntry = {
      id: entry.id,
      sequence: entry.sequence,
      assignmentId: entry.assignmentId,
      keywordId: entry.keywordId,
      keywordVersion: entry.keywordVersion,
      keywordText: entry.keywordText,
      keywordTextHash: hashFromBytes(entry.keywordTextHash),
      language: entry.language
    };
    return result;
  });
  const result: InternalRankManifestChunk = {
    workspaceId: chunk.workspaceId,
    projectId: chunk.projectId,
    jobId: manifest.jobId,
    manifestId: chunk.manifestId,
    chunkIndex: chunk.chunkIndex,
    hashSchemaVersion: CHUNK_SCHEMA,
    chunkHash: hashFromBytes(chunk.chunkHash),
    entries: publicEntries
  };
  const expectedChunkHash: RankManifestHash = {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(
      CHUNK_SCHEMA,
      rankManifestChunkHashPreimage(result)
    )
  };
  assertHashMatches(
    result.chunkHash,
    expectedChunkHash,
    "RANK_MANIFEST_CHUNK_CORRUPT"
  );
  return result;
}

function ingestCommand(
  input: InternalIngestRankChunkInput
): InternalRankChunkIngestCommand {
  return {
    schemaVersion: input.schemaVersion,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    jobId: input.jobId,
    jobItemId: input.jobItemId,
    manifestId: input.manifestId,
    chunkIndex: input.chunkIndex,
    manifestChunkHash: copyHash(input.manifestChunkHash),
    provider: input.provider,
    operation: input.operation,
    providerRequestId: input.providerRequestId,
    connectorVersion: input.connectorVersion,
    observedAt: input.observedAt,
    results: input.results
  };
}

function snapshotCreateData(
  manifest: LockedManifest,
  command: InternalRankChunkIngestCommand,
  entry: Prisma.RankExecutionManifestEntryGetPayload<{
    select: typeof ENTRY_SELECT;
  }>,
  result: InternalNormalizedRankResult,
  snapshotId: string,
  observedAt: Date,
  positionTrackingEnabled: boolean
): Prisma.RankSnapshotCreateManyInput {
  const common = {
    id: snapshotId,
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    keywordId: entry.keywordId,
    trackingContextId: manifest.trackingContextId,
    configurationVersion: manifest.configurationVersion,
    manifestId: command.manifestId,
    manifestEntryId: entry.id,
    chunkIndex: command.chunkIndex,
    sequence: entry.sequence,
    jobId: command.jobId,
    jobItemId: command.jobItemId,
    observedAt,
    positionTrackingEnabled,
    serpFeatures: [],
    dataQualityFlags: [...result.dataQualityFlags],
    provider: command.provider,
    sourceMode: "BYOK" as const,
    providerRequestId: command.providerRequestId,
    connectorVersion: command.connectorVersion
  };
  if (!result.found) {
    return {
      ...common,
      found: false,
      position: null
    };
  }
  return {
    ...common,
    found: true,
    position: result.position,
    ...(result.absolutePosition === undefined
      ? {}
      : { absolutePosition: result.absolutePosition }),
    ...(result.pixelPosition === undefined
      ? {}
      : { pixelPosition: result.pixelPosition }),
    rankingUrl: result.rankingUrl,
    normalizedRankingUrl: result.normalizedRankingUrl,
    ...(result.title === undefined ? {} : { title: result.title }),
    ...(result.snippet === undefined
      ? {}
      : { snippet: result.snippet }),
    resultType: result.resultType
  };
}

function storedManifestExecution(
  value: Prisma.JsonValue
): InternalRankExecutionParameters {
  try {
    return rankExecutionParameters(value);
  } catch {
    throw new Error("Stored rank manifest execution is invalid");
  }
}

function positionTrackingEnabled(
  execution: InternalRankExecutionParameters,
  result: InternalNormalizedRankResult
): boolean {
  if (rankExecutionPurpose(execution) === "POSITION_TRACKING") {
    return rankExecutionTracksProjectPosition(execution);
  }
  return rankExecutionTracksProjectPosition(execution) && result.found;
}

function currentProjectionInput(
  snapshot: Prisma.RankSnapshotCreateManyInput,
  updatedAt: Date
): CurrentProjectionInput {
  if (
    !(snapshot.observedAt instanceof Date) ||
    !snapshot.id ||
    (snapshot.provider !== "ARSENKIN" && snapshot.provider !== "XMLSTOCK") ||
    typeof snapshot.found !== "boolean"
  ) {
    throw new Error("Rank snapshot projection input is invalid");
  }
  return {
    workspaceId: snapshot.workspaceId,
    projectId: snapshot.projectId,
    keywordId: snapshot.keywordId,
    trackingContextId: snapshot.trackingContextId,
    configurationVersion: snapshot.configurationVersion,
    observedAt: snapshot.observedAt.toISOString(),
    snapshotId: snapshot.id,
    found: snapshot.found,
    position: snapshot.position ?? null,
    rankingUrl: snapshot.rankingUrl ?? null,
    normalizedRankingUrl: snapshot.normalizedRankingUrl ?? null,
    provider: snapshot.provider as "ARSENKIN" | "XMLSTOCK",
    sourceMode: "BYOK",
    dataQualityFlags: snapshot.dataQualityFlags as readonly string[],
    updatedAt: updatedAt.toISOString()
  };
}

async function upsertCurrentRanks(
  transaction: Prisma.TransactionClient,
  rows: readonly CurrentProjectionInput[]
): Promise<number> {
  const result = await transaction.$queryRaw<
    Array<{ readonly updatedCount: number }>
  >`
    WITH "input" AS (
      SELECT *
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      AS "row"(
        "workspaceId" TEXT,
        "projectId" TEXT,
        "keywordId" TEXT,
        "trackingContextId" TEXT,
        "configurationVersion" INTEGER,
        "observedAt" TEXT,
        "snapshotId" TEXT,
        "found" BOOLEAN,
        "position" INTEGER,
        "rankingUrl" TEXT,
        "normalizedRankingUrl" TEXT,
        "provider" TEXT,
        "sourceMode" TEXT,
        "dataQualityFlags" JSONB,
        "updatedAt" TEXT
      )
    ),
    "upserted" AS (
      INSERT INTO "current_ranks" (
        "workspace_id",
        "project_id",
        "keyword_id",
        "tracking_context_id",
        "configuration_version",
        "observed_at",
        "snapshot_id",
        "found",
        "position",
        "previous_position",
        "ranking_url",
        "normalized_ranking_url",
        "provider",
        "source_mode",
        "data_quality_flags",
        "version",
        "updated_at"
      )
      SELECT
        "workspaceId"::uuid,
        "projectId"::uuid,
        "keywordId"::uuid,
        "trackingContextId"::uuid,
        "configurationVersion",
        "observedAt"::timestamptz,
        "snapshotId"::uuid,
        "found",
        "position",
        NULL,
        "rankingUrl",
        "normalizedRankingUrl",
        "provider",
        "sourceMode"::"DataSourceMode",
        "dataQualityFlags",
        1,
        "updatedAt"::timestamptz
      FROM "input"
      ON CONFLICT (
        "workspace_id",
        "project_id",
        "keyword_id",
        "tracking_context_id",
        "configuration_version"
      )
      DO UPDATE SET
        "configuration_version" = EXCLUDED."configuration_version",
        "observed_at" = EXCLUDED."observed_at",
        "snapshot_id" = EXCLUDED."snapshot_id",
        "found" = EXCLUDED."found",
        "position" = EXCLUDED."position",
        "previous_position" = "current_ranks"."position",
        "ranking_url" = EXCLUDED."ranking_url",
        "normalized_ranking_url" =
          EXCLUDED."normalized_ranking_url",
        "provider" = EXCLUDED."provider",
        "source_mode" = EXCLUDED."source_mode",
        "data_quality_flags" = EXCLUDED."data_quality_flags",
        "version" = "current_ranks"."version" + 1,
        "updated_at" = EXCLUDED."updated_at"
      WHERE (
        EXCLUDED."observed_at",
        EXCLUDED."snapshot_id"
      ) > (
        "current_ranks"."observed_at",
        "current_ranks"."snapshot_id"
      )
      RETURNING 1
    )
    SELECT count(*)::integer AS "updatedCount"
    FROM "upserted"
  `;
  const updatedCount = result[0]?.updatedCount;
  if (
    result.length !== 1 ||
    !Number.isSafeInteger(updatedCount) ||
    updatedCount === undefined ||
    updatedCount < 0 ||
    updatedCount > rows.length
  ) {
    throw new Error("Current rank projection result is invalid");
  }
  return updatedCount;
}

async function allocateSnapshotIds(
  transaction: Prisma.TransactionClient,
  count: number
): Promise<SnapshotAllocation> {
  const rows = await transaction.$queryRaw<
    Array<{ readonly ids: string[] }>
  >`
    SELECT ARRAY(
      SELECT uuidv7()::text
      FROM generate_series(1, ${count}::integer)
    ) AS "ids"
  `;
  const ids = rows[0]?.ids;
  if (
    rows.length !== 1 ||
    !Array.isArray(ids) ||
    ids.length !== count ||
    ids.some((id) => !UUID_V7_PATTERN.test(id)) ||
    new Set(ids).size !== count
  ) {
    throw new Error("Unable to allocate rank snapshot identifiers");
  }
  return { ids };
}

function storedReceipt(
  record: ReceiptRecord,
  expectedHash: RankManifestHash
): InternalRankChunkIngestReceipt {
  const storedHash = hashFromBytes(record.ingestEnvelopeHash);
  assertHashMatches(
    storedHash,
    expectedHash,
    "RANK_INGEST_IDEMPOTENCY_CONFLICT"
  );
  if (
    record.schemaVersion !== INGEST_SCHEMA ||
    record.status !== "APPLIED" ||
    (record.provider !== "ARSENKIN" && record.provider !== "XMLSTOCK") ||
    record.operation !== "POSITIONS" ||
    !UUID_V7_PATTERN.test(record.manifestId) ||
    !UUID_V7_PATTERN.test(record.workspaceId) ||
    !UUID_V7_PATTERN.test(record.projectId) ||
    !UUID_V7_PATTERN.test(record.jobId) ||
    !UUID_V7_PATTERN.test(record.jobItemId) ||
    !UUID_V7_PATTERN.test(record.ingestedBy) ||
    !Number.isSafeInteger(record.chunkIndex) ||
    record.chunkIndex < 0 ||
    record.chunkIndex > rankCommandKeywordLimit - 1 ||
    !validCount(
      record.persistedCount,
      1,
      rankCommandKeywordLimit
    ) ||
    !validCount(record.foundCount, 0, record.persistedCount) ||
    !validCount(
      record.notFoundCount,
      0,
      record.persistedCount
    ) ||
    record.persistedCount !==
      record.foundCount + record.notFoundCount ||
    !validCount(
      record.currentUpdatedCount,
      0,
      record.persistedCount
    ) ||
    !validCount(
      record.currentSkippedCount,
      0,
      record.persistedCount
    ) ||
    record.persistedCount !==
      record.currentUpdatedCount + record.currentSkippedCount ||
    !(record.observedAt instanceof Date) ||
    Number.isNaN(record.observedAt.getTime()) ||
    !(record.appliedAt instanceof Date) ||
    Number.isNaN(record.appliedAt.getTime())
  ) {
    throw new Error("Stored rank chunk ingest receipt is invalid");
  }
  return {
    schemaVersion: "rank-ingest@1",
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    ingestedBy: record.ingestedBy,
    jobId: record.jobId,
    jobItemId: record.jobItemId,
    manifestId: record.manifestId,
    chunkIndex: record.chunkIndex,
    manifestChunkHash: hashFromBytes(record.manifestChunkHash),
    providerRequestId: record.providerRequestId,
    connectorVersion: record.connectorVersion,
    observedAt: record.observedAt.toISOString(),
    ingestEnvelopeHash: storedHash,
    status: "APPLIED",
    persistedCount: String(record.persistedCount),
    foundCount: String(record.foundCount),
    notFoundCount: String(record.notFoundCount),
    currentUpdatedCount: String(record.currentUpdatedCount),
    currentSkippedCount: String(record.currentSkippedCount),
    appliedAt: record.appliedAt.toISOString()
  };
}

function validCount(value: number, minimum: number, maximum: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function assertHashMatches(
  actual: RankManifestHash,
  expected: RankManifestHash,
  code: string
): void {
  const actualBytes = hashBytes(actual);
  const expectedBytes = hashBytes(expected);
  if (!timingSafeEqual(actualBytes, expectedBytes)) {
    resultConflict(code, "Rank result integrity check failed");
  }
}

function hashBytes(
  hash: RankManifestHash
): Uint8Array<ArrayBuffer> {
  if (
    hash.algorithm !== "SHA_256" ||
    !HASH_PATTERN.test(hash.value)
  ) {
    throw new Error("Rank result hash is invalid");
  }
  return Uint8Array.from(Buffer.from(hash.value, "hex"));
}

function hashFromBytes(value: Uint8Array): RankManifestHash {
  const bytes = Buffer.from(value);
  if (bytes.length !== 32) {
    throw new Error("Stored rank result hash has an invalid size");
  }
  return {
    algorithm: "SHA_256",
    value: bytes.toString("hex")
  };
}

function copyHash(value: RankManifestHash): RankManifestHash {
  return { algorithm: "SHA_256", value: value.value };
}

function resultConflict(code: string, message: string): never {
  throw new HttpException(
    { error: { code, message } },
    HttpStatus.CONFLICT
  );
}
