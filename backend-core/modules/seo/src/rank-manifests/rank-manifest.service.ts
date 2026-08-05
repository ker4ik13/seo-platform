import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  legacyRankManifestChunkSize,
  legacyRankProviderKeywordLimit,
  rankManifestSingleTaskChunkSize,
  xmlStockRankManifestChunkSize,
  type InternalGetRankManifestChunkInput,
  type InternalRankExecutionParameters,
  type InternalRankManifestChunk,
  type InternalRankManifestEntry,
  type InternalRankManifestSeal,
  type InternalSealRankManifestInput,
  type RankManifestHash
} from "@seo-platform/contracts";
import {
  rankManifestChunkHashPreimage,
  rankManifestDeduplicationHashPreimage,
  rankManifestHashPreimage
} from "@seo-platform/contracts";
import {
  canonicalizeJson,
  canonicalJsonSha256,
  utf8Sha256
} from "@seo-platform/contracts/canonical-json";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { semanticRankScopeHash } from "../rank-scopes/rank-scope-hash.js";
import {
  inspectRankScopeBounds,
  MAX_RANK_SCOPE_ENTRIES,
  rankScopeIsMaterializable,
  type RankScopeBounds
} from "../rank-scopes/rank-scope-bounds.js";
import { rankExecutionParameters } from "./rank-manifest-input.js";

const MANIFEST_HASH_SCHEMA = "rank-manifest@1";
const CHUNK_HASH_SCHEMA = "rank-manifest-chunk@1";
const REQUEST_HASH_SCHEMA = "rank-manifest-request@1";
const RANK_MANIFEST_TRANSACTION_MAX_WAIT_MS = 5_000;
const RANK_MANIFEST_TRANSACTION_TIMEOUT_MS = 120_000;
const MANIFEST_ENTRY_INSERT_BATCH_SIZE = 1_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

const CONTEXT_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  status: true,
  version: true,
  configurations: {
    orderBy: { configurationVersion: "desc" as const },
    take: 1,
    select: {
      configurationVersion: true,
      configurationHash: true,
      searchEngine: true,
      countryCode: true,
      regionCode: true,
      language: true,
      device: true,
      depth: true,
      domainMatchMode: true,
      domainMatchValue: true,
      safeSearch: true
    }
  }
} satisfies Prisma.TrackingContextSelect;

const ASSIGNMENT_SELECT = {
  id: true,
  keywordId: true,
  keyword: {
    select: {
      version: true,
      textOriginal: true,
      language: true
    }
  }
} satisfies Prisma.TrackingContextKeywordAssignmentSelect;

const MANIFEST_SELECT = {
  id: true,
  workspaceId: true,
  integrityWorkspaceId: true,
  projectId: true,
  jobId: true,
  estimateId: true,
  estimateExpiresAt: true,
  sealedBy: true,
  requestHash: true,
  provider: true,
  operation: true,
  projectDomain: true,
  projectStatus: true,
  projectVersion: true,
  trackingContextId: true,
  contextVersion: true,
  configurationVersion: true,
  configurationHash: true,
  semanticScopeHash: true,
  scopeHash: true,
  hashSchemaVersion: true,
  manifestHash: true,
  deduplicationHash: true,
  pairCount: true,
  chunkCount: true,
  chunkSize: true,
  execution: true,
  retention: true,
  status: true,
  sealedAt: true,
  closedAt: true,
  chunks: {
    orderBy: { chunkIndex: "asc" as const },
    select: {
      chunkIndex: true,
      hashSchemaVersion: true,
      chunkHash: true,
      entryCount: true
    }
  }
} satisfies Prisma.RankExecutionManifestSelect;

const CHUNK_SELECT = {
  workspaceId: true,
  projectId: true,
  manifestId: true,
  chunkIndex: true,
  hashSchemaVersion: true,
  chunkHash: true,
  entryCount: true,
  manifest: {
    select: {
      jobId: true,
      pairCount: true,
      chunkCount: true,
      chunkSize: true,
      status: true
    }
  },
  entries: {
    orderBy: { sequence: "asc" as const },
    select: {
      id: true,
      sequence: true,
      assignmentId: true,
      keywordId: true,
      keywordVersion: true,
      keywordText: true,
      keywordTextHash: true,
      language: true
    }
  }
} satisfies Prisma.RankExecutionManifestChunkSelect;

type ContextRecord = Prisma.TrackingContextGetPayload<{
  select: typeof CONTEXT_SELECT;
}>;
type AssignmentRecord =
  Prisma.TrackingContextKeywordAssignmentGetPayload<{
    select: typeof ASSIGNMENT_SELECT;
  }>;
type ManifestRecord = Prisma.RankExecutionManifestGetPayload<{
  select: typeof MANIFEST_SELECT;
}>;
type ChunkRecord = Prisma.RankExecutionManifestChunkGetPayload<{
  select: typeof CHUNK_SELECT;
}>;

interface ManifestAllocation {
  readonly manifestId: string;
  readonly sealedAt: Date;
  readonly entryIds: readonly string[];
}

interface ManifestEntrySnapshot extends InternalRankManifestEntry {
  readonly chunkIndex: number;
}

interface ManifestChunkSnapshot {
  readonly chunkIndex: number;
  readonly chunkHash: RankManifestHash;
  readonly entries: readonly ManifestEntrySnapshot[];
}

@Injectable()
export class RankManifestService {
  public constructor(private readonly prisma: PrismaService) {}

  public async seal(
    input: InternalSealRankManifestInput
  ): Promise<InternalRankManifestSeal> {
    const requestHash = canonicalHashBytes(REQUEST_HASH_SCHEMA, input);
    let attemptedDeduplicationHash: Uint8Array<ArrayBuffer> | undefined;
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const snapshotAt = await acquireManifestSnapshot(
            transaction,
            input.projectId
          );
          const existing =
            await transaction.rankExecutionManifest.findFirst({
              where: {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                jobId: input.jobId
              },
              select: MANIFEST_SELECT
            });
          if (existing) {
            assertExactReplay(existing.requestHash, requestHash);
            return storedManifestSeal(existing);
          }

          assertEstimateNotExpired(input, snapshotAt);
          const { context, configuration, assignments } =
            await currentManifestScope(transaction, input);
          assertEstimateStillCurrent(
            input,
            context,
            configuration,
            assignments
          );
          const allocation = await allocateManifest(
            transaction,
            assignments.length,
            snapshotAt
          );
          const chunkSize = rankManifestChunkSize(input.provider);
          const entries = manifestEntries(
            allocation.entryIds,
            assignments,
            chunkSize
          );
          const deduplicationHash = rankManifestHash(
            rankManifestDeduplicationHashPreimage(input, entries)
          );
          attemptedDeduplicationHash = hashBytes(deduplicationHash);
          const activeEquivalent =
            await transaction.rankExecutionManifest.findFirst({
              where: {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                provider: input.provider,
                deduplicationHash: attemptedDeduplicationHash,
                status: "SEALED",
                NOT: { jobId: input.jobId }
              },
              select: { jobId: true }
            });
          if (activeEquivalent) {
            equivalentRunActive();
          }
          const chunks = manifestChunks(
            allocation.manifestId,
            entries,
            chunkSize
          );
          const sealWithoutHash = manifestSealWithoutHash(
            input,
            allocation,
            chunks.length,
            chunkSize,
            deduplicationHash
          );
          const manifestHash = rankManifestHash(
            rankManifestHashPreimage(
              sealWithoutHash,
              chunks.map((chunk) => chunk.chunkHash)
            )
          );
          const seal: InternalRankManifestSeal = {
            ...sealWithoutHash,
            manifestHash
          };

          await transaction.rankExecutionManifest.create({
            data: {
              id: seal.id,
              workspaceId: seal.workspaceId,
              integrityWorkspaceId: seal.workspaceId,
              projectId: seal.projectId,
              jobId: seal.jobId,
              estimateId: seal.estimateId,
              estimateExpiresAt: new Date(seal.estimateExpiresAt),
              sealedBy: input.actorId,
              requestHash: databaseBytes(requestHash),
              provider: seal.provider,
              operation: seal.operation,
              projectDomain: seal.project.domain,
              projectStatus: seal.project.status,
              projectVersion: seal.project.version,
              trackingContextId: seal.trackingContextId,
              contextVersion: seal.contextVersion,
              configurationVersion: seal.configurationVersion,
              configurationHash: hashBytes(seal.configurationHash),
              semanticScopeHash: hashBytes(seal.semanticScopeHash),
              scopeHash: hashBytes(seal.scopeHash),
              hashSchemaVersion: seal.hashSchemaVersion,
              manifestHash: hashBytes(seal.manifestHash),
              deduplicationHash: hashBytes(seal.deduplicationHash),
              pairCount: Number(seal.pairCount),
              chunkCount: Number(seal.chunkCount),
              chunkSize: Number(seal.chunkSize),
              execution: jsonInput(seal.execution),
              retention: jsonInput(seal.retention),
              status: "BUILDING",
              sealedAt: allocation.sealedAt
            }
          });
          await transaction.rankExecutionManifestChunk.createMany({
            data: chunks.map((chunk) => ({
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              manifestId: allocation.manifestId,
              chunkIndex: chunk.chunkIndex,
              hashSchemaVersion: CHUNK_HASH_SCHEMA,
              chunkHash: hashBytes(chunk.chunkHash),
              entryCount: chunk.entries.length
            }))
          });
          const manifestEntryRows = entries.map((entry) => ({
              id: entry.id,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              manifestId: allocation.manifestId,
              chunkIndex: entry.chunkIndex,
              sequence: entry.sequence,
              assignmentId: entry.assignmentId,
              keywordId: entry.keywordId,
              keywordVersion: entry.keywordVersion,
              keywordText: entry.keywordText,
              keywordTextHash: hashBytes(entry.keywordTextHash),
              language: entry.language
            }));
          for (
            let offset = 0;
            offset < manifestEntryRows.length;
            offset += MANIFEST_ENTRY_INSERT_BATCH_SIZE
          ) {
            const batch = manifestEntryRows.slice(
              offset,
              offset + MANIFEST_ENTRY_INSERT_BATCH_SIZE
            );
            const inserted =
              await transaction.rankExecutionManifestEntry.createMany({
                data: batch
              });
            if (inserted.count !== batch.length) {
              throw new Error(
                "Rank manifest entry batch was not fully persisted"
              );
            }
          }
          await transaction.rankExecutionManifest.update({
            where: { id: seal.id },
            data: { status: "SEALED" }
          });
          return seal;
        },
        {
          isolationLevel: "RepeatableRead",
          maxWait: RANK_MANIFEST_TRANSACTION_MAX_WAIT_MS,
          timeout: RANK_MANIFEST_TRANSACTION_TIMEOUT_MS
        }
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const winner =
          await this.prisma.rankExecutionManifest.findFirst({
            where: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              jobId: input.jobId
            },
            select: MANIFEST_SELECT
          });
        if (winner) {
          assertExactReplay(winner.requestHash, requestHash);
          return storedManifestSeal(winner);
        }
        if (attemptedDeduplicationHash) {
          const activeEquivalent =
            await this.prisma.rankExecutionManifest.findFirst({
              where: {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                provider: input.provider,
                deduplicationHash: attemptedDeduplicationHash,
                status: "SEALED"
              },
              select: { jobId: true }
            });
          if (
            activeEquivalent &&
            activeEquivalent.jobId !== input.jobId
          ) {
            equivalentRunActive();
          }
        }
      }
      throw error;
    }
  }

  public async getChunk(
    input: InternalGetRankManifestChunkInput
  ): Promise<InternalRankManifestChunk> {
    const chunk =
      await this.prisma.rankExecutionManifestChunk.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          manifestId: input.manifestId,
          chunkIndex: input.chunkIndex,
          manifest: {
            jobId: input.jobId,
            status: "SEALED"
          }
        },
        select: CHUNK_SELECT
      });
    if (!chunk) {
      throw new NotFoundException("Rank manifest chunk not found");
    }
    return storedManifestChunk(chunk, input);
  }
}

async function currentManifestScope(
  transaction: Prisma.TransactionClient,
  input: InternalSealRankManifestInput
): Promise<{
  readonly context: ContextRecord;
  readonly configuration: ContextRecord["configurations"][number];
  readonly assignments: readonly AssignmentRecord[];
}> {
  const context = await transaction.trackingContext.findFirst({
    where: {
      id: input.estimate.trackingContextId,
      workspaceId: input.workspaceId,
      projectId: input.projectId
    },
    select: CONTEXT_SELECT
  });
  if (!context) {
    throw new NotFoundException("Tracking context not found");
  }
  const configuration = context.configurations[0];
  if (!configuration) {
    throw new Error("Tracking context has no configuration version");
  }
  const bounds = await inspectRankScopeBounds(transaction, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    contextId: context.id
  });
  assertManifestScopeBounds(input, bounds);
  const assignments =
    await transaction.trackingContextKeywordAssignment.findMany({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        contextId: context.id,
        removedAt: null,
        keyword: { status: "ACTIVE" }
      },
      orderBy: { keywordId: "asc" },
      take: MAX_RANK_SCOPE_ENTRIES + 1,
      select: ASSIGNMENT_SELECT
    });
  return { context, configuration, assignments };
}

function assertManifestScopeBounds(
  input: InternalSealRankManifestInput,
  bounds: RankScopeBounds
): void {
  if (
    bounds.assignmentCount < 1 ||
    bounds.assignmentCount !== Number(input.estimate.pairCount) ||
    !rankScopeIsMaterializable(bounds)
  ) {
    manifestConflict(
      "ESTIMATE_STALE",
      "Rank scope exceeds the sealed provider execution limits"
    );
  }
}

function assertEstimateNotExpired(
  input: InternalSealRankManifestInput,
  snapshotAt: Date
): void {
  const expiresAt = new Date(input.estimate.expiresAt);
  if (
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt.toISOString() !== input.estimate.expiresAt ||
    snapshotAt.getTime() >= expiresAt.getTime()
  ) {
    manifestConflict(
      "ESTIMATE_EXPIRED",
      "Rank estimate expired before the manifest could be sealed"
    );
  }
}

function assertEstimateStillCurrent(
  input: InternalSealRankManifestInput,
  context: ContextRecord,
  configuration: ContextRecord["configurations"][number],
  assignments: readonly AssignmentRecord[]
): void {
  const expectedPairCount = Number(input.estimate.pairCount);
  const currentSemanticHash =
    assignments.length <= MAX_RANK_SCOPE_ENTRIES
      ? semanticRankScopeHash(context, configuration, assignments)
      : undefined;
  if (
    input.project.status !== "ACTIVE" ||
    context.status !== "ACTIVE" ||
    context.id !== input.estimate.trackingContextId ||
    context.version !== input.estimate.contextVersion ||
    configuration.configurationVersion !==
      input.estimate.configurationVersion ||
    configuration.configurationHash !==
      input.estimate.configurationHash.value ||
    assignments.length < 1 ||
    assignments.length > MAX_RANK_SCOPE_ENTRIES ||
    assignments.length !== expectedPairCount ||
    currentSemanticHash !== input.estimate.semanticScopeHash.value ||
    !executionMatchesConfiguration(input.execution, configuration)
  ) {
    manifestConflict(
      "ESTIMATE_STALE",
      "Rank estimate no longer matches the current project scope"
    );
  }
  assertUniqueAssignments(assignments);
}

function executionMatchesConfiguration(
  execution: InternalRankExecutionParameters,
  configuration: ContextRecord["configurations"][number]
): boolean {
  const domainMatchRule =
    configuration.domainMatchMode === "SPECIFIC_URL" ||
    configuration.domainMatchMode === "URL_PREFIX"
      ? {
          mode: configuration.domainMatchMode,
          value: configuration.domainMatchValue
        }
      : { mode: configuration.domainMatchMode };
  const expected = {
    searchEngine: configuration.searchEngine,
    countryCode: configuration.countryCode,
    ...(configuration.regionCode
      ? { regionCode: configuration.regionCode }
      : {}),
    language: configuration.language,
    device: configuration.device,
    depth: configuration.depth,
    domainMatchRule,
    safeSearch: configuration.safeSearch
  };
  const actual = {
    searchEngine: execution.searchEngine,
    countryCode: execution.countryCode,
    ...(execution.regionCode
      ? { regionCode: execution.regionCode }
      : {}),
    language: execution.language,
    device: execution.device,
    depth: execution.depth,
    domainMatchRule: execution.domainMatchRule,
    safeSearch: execution.safeSearch
  };
  return canonicalizeJson(expected) === canonicalizeJson(actual);
}

function assertUniqueAssignments(
  assignments: readonly AssignmentRecord[]
): void {
  const assignmentIds = new Set<string>();
  const keywordIds = new Set<string>();
  for (const assignment of assignments) {
    if (
      assignmentIds.has(assignment.id) ||
      keywordIds.has(assignment.keywordId)
    ) {
      throw new Error("Rank manifest scope contains duplicate assignments");
    }
    assignmentIds.add(assignment.id);
    keywordIds.add(assignment.keywordId);
  }
}

async function allocateManifest(
  transaction: Prisma.TransactionClient,
  entryCount: number,
  sealedAt: Date
): Promise<ManifestAllocation> {
  const rows = await transaction.$queryRaw<
    Array<{
      manifestId: string;
      entryIds: string[];
    }>
  >`
    SELECT
      uuidv7()::text AS "manifestId",
      ARRAY(
        SELECT uuidv7()::text
        FROM generate_series(1, ${entryCount}::integer)
      ) AS "entryIds"
  `;
  const allocation = rows[0];
  if (
    rows.length !== 1 ||
    !allocation ||
    !UUID_PATTERN.test(allocation.manifestId) ||
    !Array.isArray(allocation.entryIds) ||
    allocation.entryIds.length !== entryCount ||
    allocation.entryIds.some(
      (id) => typeof id !== "string" || !UUID_PATTERN.test(id)
    ) ||
    new Set(allocation.entryIds).size !== entryCount
  ) {
    throw new Error("Unable to allocate immutable rank manifest");
  }
  return { ...allocation, sealedAt };
}

async function acquireManifestSnapshot(
  transaction: Prisma.TransactionClient,
  projectId: string
): Promise<Date> {
  const rows = await transaction.$queryRaw<
    Array<{ readonly snapshotAt: Date }>
  >`
    SELECT
      statement_timestamp() AS "snapshotAt",
      pg_advisory_xact_lock(
        hashtextextended(${`rank-manifest:${projectId}`}, 0)
      ) IS NULL AS "lockAcquired"
  `;
  const snapshotAt = rows[0]?.snapshotAt;
  if (
    rows.length !== 1 ||
    !(snapshotAt instanceof Date) ||
    Number.isNaN(snapshotAt.getTime())
  ) {
    throw new Error("Unable to acquire immutable rank manifest snapshot");
  }
  return snapshotAt;
}

function manifestEntries(
  entryIds: readonly string[],
  assignments: readonly AssignmentRecord[],
  chunkSize: number
): readonly ManifestEntrySnapshot[] {
  return assignments.map((assignment, sequence) => {
    const id = entryIds[sequence];
    if (!id) {
      throw new Error("Rank manifest entry allocation is incomplete");
    }
    return {
      id,
      sequence,
      chunkIndex: Math.floor(sequence / chunkSize),
      assignmentId: assignment.id,
      keywordId: assignment.keywordId,
      keywordVersion: assignment.keyword.version,
      keywordText: assignment.keyword.textOriginal,
      keywordTextHash: sha256Value(assignment.keyword.textOriginal),
      language: assignment.keyword.language
    };
  });
}

function manifestChunks(
  manifestId: string,
  entries: readonly ManifestEntrySnapshot[],
  chunkSize: number
): readonly ManifestChunkSnapshot[] {
  const chunks: ManifestChunkSnapshot[] = [];
  for (
    let offset = 0;
    offset < entries.length;
    offset += chunkSize
  ) {
    const chunkEntries = entries.slice(
      offset,
      offset + chunkSize
    );
    const chunkIndex = Math.floor(offset / chunkSize);
    const publicEntries = chunkEntries.map(manifestEntry);
    chunks.push({
      chunkIndex,
      entries: chunkEntries,
      chunkHash: canonicalHashValue(
        CHUNK_HASH_SCHEMA,
        rankManifestChunkHashPreimage({
          hashSchemaVersion: CHUNK_HASH_SCHEMA,
          manifestId,
          chunkIndex,
          entries: publicEntries
        })
      )
    });
  }
  return chunks;
}

function manifestSealWithoutHash(
  input: InternalSealRankManifestInput,
  allocation: ManifestAllocation,
  chunkCount: number,
  chunkSize: number,
  deduplicationHash: RankManifestHash
): Omit<InternalRankManifestSeal, "manifestHash"> {
  return {
    id: allocation.manifestId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    jobId: input.jobId,
    estimateId: input.estimateId,
    estimateExpiresAt: input.estimate.expiresAt,
    sealedBy: input.actorId,
    trackingContextId: input.estimate.trackingContextId,
    provider: input.provider,
    operation: input.operation,
    project: input.project,
    contextVersion: input.estimate.contextVersion,
    configurationVersion: input.estimate.configurationVersion,
    configurationHash: input.estimate.configurationHash,
    semanticScopeHash: input.estimate.semanticScopeHash,
    scopeHash: input.estimate.scopeHash,
    hashSchemaVersion: MANIFEST_HASH_SCHEMA,
    deduplicationHash,
    pairCount: input.estimate.pairCount,
    chunkCount: String(chunkCount),
    chunkSize: String(chunkSize) as "1" | "250" | "15000",
    execution: input.execution,
    retention: input.retention,
    status: "SEALED",
    sealedAt: allocation.sealedAt.toISOString()
  };
}

function storedManifestSeal(
  record: ManifestRecord
): InternalRankManifestSeal {
  const execution = storedExecution(record.execution);
  const retention = storedRetention(record.retention);
  const sealedAtValid =
    record.sealedAt instanceof Date &&
    !Number.isNaN(record.sealedAt.getTime());
  const lifecycleValid =
    (record.status === "SEALED" && record.closedAt === null) ||
    (record.status === "CLOSED" &&
      sealedAtValid &&
      record.closedAt instanceof Date &&
      !Number.isNaN(record.closedAt.getTime()) &&
      record.closedAt.getTime() >= record.sealedAt.getTime());
  if (
    (record.provider !== "ARSENKIN" && record.provider !== "XMLSTOCK") ||
    record.operation !== "POSITIONS" ||
    record.projectStatus !== "ACTIVE" ||
    !lifecycleValid ||
    record.hashSchemaVersion !== MANIFEST_HASH_SCHEMA ||
    !UUID_PATTERN.test(record.id) ||
    !UUID_PATTERN.test(record.workspaceId) ||
    !UUID_PATTERN.test(record.integrityWorkspaceId) ||
    !UUID_PATTERN.test(record.projectId) ||
    !UUID_PATTERN.test(record.jobId) ||
    !UUID_PATTERN.test(record.estimateId) ||
    !UUID_PATTERN.test(record.sealedBy) ||
    !UUID_PATTERN.test(record.trackingContextId) ||
    !Number.isSafeInteger(record.projectVersion) ||
    record.projectVersion < 1 ||
    !Number.isSafeInteger(record.contextVersion) ||
    record.contextVersion < 1 ||
    !Number.isSafeInteger(record.configurationVersion) ||
    record.configurationVersion < 1 ||
    !Number.isSafeInteger(record.pairCount) ||
    record.pairCount < 1 ||
    record.pairCount > MAX_RANK_SCOPE_ENTRIES ||
    !Number.isSafeInteger(record.chunkCount) ||
    !validStoredManifestShape(
      record.pairCount,
      record.chunkCount,
      record.chunkSize
    ) ||
    !sealedAtValid ||
    !(record.estimateExpiresAt instanceof Date) ||
    Number.isNaN(record.estimateExpiresAt.getTime()) ||
    record.estimateExpiresAt.getTime() <= record.sealedAt.getTime() ||
    record.chunks.length !== record.chunkCount
  ) {
    throw new Error("Stored rank manifest header is invalid");
  }
  const configurationHash = hashFromBytes(record.configurationHash);
  const semanticScopeHash = hashFromBytes(record.semanticScopeHash);
  const scopeHash = hashFromBytes(record.scopeHash);
  const deduplicationHash = hashFromBytes(record.deduplicationHash);
  const manifestHash = hashFromBytes(record.manifestHash);
  let persistedEntries = 0;
  const chunkHashes = record.chunks.map((chunk, index) => {
    const expectedEntryCount = Math.min(
      record.chunkSize,
      record.pairCount - index * record.chunkSize
    );
    if (
      chunk.chunkIndex !== index ||
      chunk.hashSchemaVersion !== CHUNK_HASH_SCHEMA ||
      chunk.entryCount !== expectedEntryCount
    ) {
      throw new Error("Stored rank manifest chunk header is invalid");
    }
    persistedEntries += chunk.entryCount;
    return hashFromBytes(chunk.chunkHash);
  });
  if (persistedEntries !== record.pairCount) {
    throw new Error("Stored rank manifest entry count is invalid");
  }
  const sealWithoutHash: Omit<
    InternalRankManifestSeal,
    "manifestHash"
  > = {
    id: record.id,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    jobId: record.jobId,
    estimateId: record.estimateId,
    estimateExpiresAt: record.estimateExpiresAt.toISOString(),
    sealedBy: record.sealedBy,
    trackingContextId: record.trackingContextId,
    provider: record.provider,
    operation: "POSITIONS",
    project: {
      id: record.projectId,
      workspaceId: record.workspaceId,
      domain: record.projectDomain,
      status: "ACTIVE",
      version: record.projectVersion
    },
    contextVersion: record.contextVersion,
    configurationVersion: record.configurationVersion,
    configurationHash,
    semanticScopeHash,
    scopeHash,
    hashSchemaVersion: MANIFEST_HASH_SCHEMA,
    deduplicationHash,
    pairCount: String(record.pairCount),
    chunkCount: String(record.chunkCount),
    chunkSize: String(record.chunkSize) as "1" | "250" | "15000",
    execution,
    retention,
    status: "SEALED",
    sealedAt: record.sealedAt.toISOString()
  };
  const expectedManifestHash = rankManifestHash(
    rankManifestHashPreimage(
      {
        ...sealWithoutHash,
        workspaceId: record.integrityWorkspaceId,
        project: {
          ...sealWithoutHash.project,
          workspaceId: record.integrityWorkspaceId
        }
      },
      chunkHashes
    )
  );
  if (!hashValuesEqual(manifestHash, expectedManifestHash)) {
    throw new Error("Stored rank manifest hash is invalid");
  }
  return {
    ...sealWithoutHash,
    manifestHash
  };
}

function validStoredManifestShape(
  pairCount: number,
  chunkCount: number,
  chunkSize: number
): boolean {
  if (
    !Number.isSafeInteger(pairCount) ||
    !Number.isSafeInteger(chunkCount) ||
    !Number.isSafeInteger(chunkSize)
  ) {
    return false;
  }
  if (chunkSize === legacyRankManifestChunkSize) {
    return (
      pairCount >= 1 &&
      pairCount <= legacyRankProviderKeywordLimit &&
      chunkCount ===
        Math.ceil(pairCount / legacyRankManifestChunkSize)
    );
  }
  if (chunkSize === xmlStockRankManifestChunkSize) {
    return (
      pairCount >= 1 &&
      pairCount <= MAX_RANK_SCOPE_ENTRIES &&
      chunkCount === pairCount
    );
  }
  return (
    chunkSize === rankManifestSingleTaskChunkSize &&
    pairCount >= 1 &&
    pairCount <= MAX_RANK_SCOPE_ENTRIES &&
    chunkCount === 1
  );
}

function rankManifestChunkSize(provider: "ARSENKIN" | "XMLSTOCK"): number {
  return provider === "XMLSTOCK"
    ? xmlStockRankManifestChunkSize
    : rankManifestSingleTaskChunkSize;
}

function storedManifestChunk(
  record: ChunkRecord,
  input: InternalGetRankManifestChunkInput
): InternalRankManifestChunk {
  if (
    record.workspaceId !== input.workspaceId ||
    record.projectId !== input.projectId ||
    record.manifestId !== input.manifestId ||
    record.chunkIndex !== input.chunkIndex ||
    record.manifest.jobId !== input.jobId ||
    record.manifest.status !== "SEALED" ||
    record.chunkIndex < 0 ||
    record.chunkIndex >= record.manifest.chunkCount ||
    record.hashSchemaVersion !== CHUNK_HASH_SCHEMA ||
    record.entryCount !== record.entries.length ||
    record.entries.length < 1 ||
    !validStoredManifestShape(
      record.manifest.pairCount,
      record.manifest.chunkCount,
      record.manifest.chunkSize
    ) ||
    record.entries.length > record.manifest.chunkSize
  ) {
    throw new Error("Stored rank manifest chunk is invalid");
  }
  const entries = record.entries.map((entry, offset) => {
    const expectedSequence =
      record.chunkIndex * record.manifest.chunkSize + offset;
    if (
      entry.sequence !== expectedSequence ||
      entry.keywordVersion < 1 ||
      !entry.keywordText ||
      !entry.language
    ) {
      throw new Error("Stored rank manifest entry is invalid");
    }
    const snapshot: InternalRankManifestEntry = {
      id: entry.id,
      sequence: entry.sequence,
      assignmentId: entry.assignmentId,
      keywordId: entry.keywordId,
      keywordVersion: entry.keywordVersion,
      keywordText: entry.keywordText,
      keywordTextHash: hashFromBytes(entry.keywordTextHash),
      language: entry.language
    };
    if (
      !hashValuesEqual(
        snapshot.keywordTextHash,
        sha256Value(snapshot.keywordText)
      )
    ) {
      throw new Error("Stored rank manifest keyword hash is invalid");
    }
    return snapshot;
  });
  const result: InternalRankManifestChunk = {
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    jobId: record.manifest.jobId,
    manifestId: record.manifestId,
    chunkIndex: record.chunkIndex,
    hashSchemaVersion: CHUNK_HASH_SCHEMA,
    chunkHash: hashFromBytes(record.chunkHash),
    entries
  };
  const expectedHash = canonicalHashValue(
    CHUNK_HASH_SCHEMA,
    rankManifestChunkHashPreimage(result)
  );
  if (!hashValuesEqual(result.chunkHash, expectedHash)) {
    throw new Error("Stored rank manifest chunk hash is invalid");
  }
  return result;
}

function manifestEntry(
  entry: ManifestEntrySnapshot
): InternalRankManifestEntry {
  return {
    id: entry.id,
    sequence: entry.sequence,
    assignmentId: entry.assignmentId,
    keywordId: entry.keywordId,
    keywordVersion: entry.keywordVersion,
    keywordText: entry.keywordText,
    keywordTextHash: entry.keywordTextHash,
    language: entry.language
  };
}

function storedExecution(value: Prisma.JsonValue): InternalRankExecutionParameters {
  try {
    const execution = rankExecutionParameters(value);
    if (canonicalizeJson(execution) !== canonicalizeJson(value)) {
      throw new Error("Stored rank manifest execution is non-canonical");
    }
    return execution;
  } catch {
    throw new Error("Stored rank manifest execution is invalid");
  }
}

function storedRetention(
  value: Prisma.JsonValue
): InternalSealRankManifestInput["retention"] {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    value.normalizedRankHistory !== "LONG_TERM" ||
    value.rawSerp !== "NOT_COLLECTED"
  ) {
    throw new Error("Stored rank manifest retention is invalid");
  }
  return {
    normalizedRankHistory: "LONG_TERM",
    rawSerp: "NOT_COLLECTED"
  };
}

function assertExactReplay(
  storedHash: Uint8Array,
  requestHash: Buffer
): void {
  const stored = Buffer.from(storedHash);
  if (
    stored.length !== requestHash.length ||
    !timingSafeEqual(stored, requestHash)
  ) {
    manifestConflict(
      "IDEMPOTENCY_CONFLICT",
      "Rank manifest job is already sealed for another command"
    );
  }
}

function rankManifestHash(value: unknown): RankManifestHash {
  return canonicalHashValue(MANIFEST_HASH_SCHEMA, value);
}

function canonicalHashValue(
  schemaVersion: string,
  value: unknown
): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(schemaVersion, value)
  };
}

function canonicalHashBytes(
  schemaVersion: string,
  value: unknown
): Buffer {
  return Buffer.from(canonicalJsonSha256(schemaVersion, value), "hex");
}

function sha256Value(value: string): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: utf8Sha256(value)
  };
}

function hashBytes(
  hash: RankManifestHash
): Uint8Array<ArrayBuffer> {
  if (hash.algorithm !== "SHA_256" || !HASH_PATTERN.test(hash.value)) {
    throw new Error("Rank manifest hash is invalid");
  }
  return databaseBytes(Buffer.from(hash.value, "hex"));
}

function hashFromBytes(value: Uint8Array): RankManifestHash {
  const bytes = Buffer.from(value);
  if (bytes.length !== 32) {
    throw new Error("Stored rank manifest hash has an invalid size");
  }
  return {
    algorithm: "SHA_256",
    value: bytes.toString("hex")
  };
}

function hashValuesEqual(
  left: RankManifestHash,
  right: RankManifestHash
): boolean {
  const leftBytes = hashBytes(left);
  const rightBytes = hashBytes(right);
  return timingSafeEqual(leftBytes, rightBytes);
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalizeJson(value)) as Prisma.InputJsonValue;
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function manifestConflict(code: string, message: string): never {
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

function equivalentRunActive(): never {
  manifestConflict(
    "EQUIVALENT_RUN_ACTIVE",
    "An equivalent rank run is already active"
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
