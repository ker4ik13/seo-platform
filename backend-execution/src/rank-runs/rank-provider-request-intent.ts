import { types as nodeTypes } from "node:util";
import {
  rankExecutionPolicyShape,
  rankManifestChunkHashPreimage,
  type InternalRankExecutionParameters,
  type InternalRankManifestChunk,
  type InternalRankManifestEntry,
  type InternalSealRankManifestInput,
  type RankManifestHash
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  canonicalizeJson,
  utf8Sha256
} from "@seo-platform/contracts/canonical-json";
import { parseRankExecutionParameters } from "../rank-estimates/rank-estimate-execution.js";

export const RANK_PROVIDER_REQUEST_INTENT_SCHEMA =
  "rank-provider-request-intent@1" as const;

const MANIFEST_HASH_SCHEMA = "rank-manifest@1" as const;
const MANIFEST_CHUNK_HASH_SCHEMA =
  "rank-manifest-chunk@1" as const;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,63}$/u;

export interface RankProviderRequestIntentKeywordV1 {
  readonly manifestEntryId: string;
  readonly sequence: number;
  readonly keywordId: string;
  readonly keywordText: string;
  readonly keywordTextHash: RankManifestHash;
  readonly language: string;
}

/**
 * Private Jobs-owned command for one exact adapter request.
 *
 * It intentionally contains keyword text, so it must never cross a public
 * API, queue payload, event, metric or error. The only log exception is a
 * bounded opt-in excerpt on the assigned trusted worker (ADR-2026-056).
 * Credential identity and
 * material are deliberately unrepresentable and are joined only after an
 * execution grant has been consumed.
 */
export interface RankProviderRequestIntentV1 {
  readonly schemaVersion: "rank-provider-request-intent@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly estimateId: string;
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  readonly operation: "POSITIONS";
  readonly project: {
    readonly domain: string;
    readonly version: number;
  };
  readonly execution: InternalRankExecutionParameters;
  readonly manifest: {
    readonly id: string;
    readonly hashSchemaVersion: "rank-manifest@1";
    readonly manifestHash: RankManifestHash;
    readonly pairCount: string;
  };
  readonly manifestChunk: {
    readonly manifestId: string;
    readonly chunkIndex: number;
    readonly hashSchemaVersion: "rank-manifest-chunk@1";
    readonly chunkHash: RankManifestHash;
  };
  readonly executionConnectorVersion: string;
  readonly providerPolicyVersion: string;
  readonly keywords: readonly RankProviderRequestIntentKeywordV1[];
}

export interface RankProviderRequestIntentBuildInput {
  readonly command: InternalSealRankManifestInput;
  readonly chunk: InternalRankManifestChunk;
  readonly jobItemId: string;
  readonly manifestHash: RankManifestHash;
  readonly executionConnectorVersion: string;
  readonly providerPolicyVersion: string;
}

interface RankProviderIntentBounds {
  readonly version: string;
  readonly maximumPairs: number;
  readonly chunkSize: number;
  readonly maximumChunkIndex: number;
}

/**
 * Builds a canonical, immutable and secret-free adapter command from the
 * authoritative sealed inputs. The complete source chunk is verified before
 * it is reduced to the privacy-minimal keyword projection.
 */
export function buildRankProviderRequestIntent(
  value: RankProviderRequestIntentBuildInput
): RankProviderRequestIntentV1 {
  const input = exactRecord(value, [
    "command",
    "chunk",
    "jobItemId",
    "manifestHash",
    "executionConnectorVersion",
    "providerPolicyVersion"
  ]);
  const providerPolicy = rankProviderPolicy(
    input.providerPolicyVersion
  );
  const command = manifestCommand(
    input.command,
    providerPolicy
  );
  const pairCount = Number(command.estimate.pairCount);
  const chunk = manifestChunk(input.chunk, pairCount, providerPolicy);
  const jobItemId = uuidV7(input.jobItemId);
  const manifestHash = hash(input.manifestHash);
  const executionConnectorVersion = version(
    input.executionConnectorVersion
  );
  const providerPolicyVersion = providerPolicy.version;

  if (
    chunk.workspaceId !== command.workspaceId ||
    chunk.projectId !== command.projectId ||
    chunk.jobId !== command.jobId
  ) {
    invalid();
  }

  return rankProviderRequestIntent({
    schemaVersion: RANK_PROVIDER_REQUEST_INTENT_SCHEMA,
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    actorId: command.actorId,
    jobId: command.jobId,
    jobItemId,
    estimateId: command.estimateId,
    provider: command.provider,
    operation: command.operation,
    project: {
      domain: command.project.domain,
      version: command.project.version
    },
    execution: command.execution,
    manifest: {
      id: chunk.manifestId,
      hashSchemaVersion: MANIFEST_HASH_SCHEMA,
      manifestHash,
      pairCount: command.estimate.pairCount
    },
    manifestChunk: {
      manifestId: chunk.manifestId,
      chunkIndex: chunk.chunkIndex,
      hashSchemaVersion: chunk.hashSchemaVersion,
      chunkHash: chunk.chunkHash
    },
    executionConnectorVersion,
    providerPolicyVersion,
    keywords: chunk.entries.map((entry) => ({
      manifestEntryId: entry.id,
      sequence: entry.sequence,
      keywordId: entry.keywordId,
      keywordText: entry.keywordText,
      keywordTextHash: entry.keywordTextHash,
      language: entry.language
    }))
  });
}

/**
 * Parses stored JSON through a recursively exact allowlist. Re-hashing the
 * returned value is stable regardless of source object key insertion order.
 */
export function rankProviderRequestIntent(
  value: unknown
): RankProviderRequestIntentV1 {
  const input = exactRecord(value, [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "jobItemId",
    "estimateId",
    "provider",
    "operation",
    "project",
    "execution",
    "manifest",
    "manifestChunk",
    "executionConnectorVersion",
    "providerPolicyVersion",
    "keywords"
  ]);
  const project = exactRecord(input.project, [
    "domain",
    "version"
  ]);
  const manifest = exactRecord(input.manifest, [
    "id",
    "hashSchemaVersion",
    "manifestHash",
    "pairCount"
  ]);
  const manifestChunk = exactRecord(input.manifestChunk, [
    "manifestId",
    "chunkIndex",
    "hashSchemaVersion",
    "chunkHash"
  ]);
  const providerPolicy = rankProviderPolicy(
    input.providerPolicyVersion
  );
  const pairCount = decimal(
    manifest.pairCount,
    providerPolicy.maximumPairs
  );
  const chunkIndex = boundedInteger(
    manifestChunk.chunkIndex,
    0,
    providerPolicy.maximumChunkIndex
  );
  const keywordInputs = exactArray(
    input.keywords,
    1,
    providerPolicy.chunkSize
  );
  const expectedKeywordCount = expectedChunkEntryCount(
    Number(pairCount),
    chunkIndex,
    providerPolicy
  );
  if (
    input.schemaVersion !== RANK_PROVIDER_REQUEST_INTENT_SCHEMA ||
    (input.provider !== "ARSENKIN" && input.provider !== "XMLSTOCK") ||
    (input.provider === "XMLSTOCK") !==
      (rankExecutionPolicyShape(providerPolicy.version)?.provider === "XMLSTOCK") ||
    input.operation !== "POSITIONS" ||
    manifest.hashSchemaVersion !== MANIFEST_HASH_SCHEMA ||
    manifestChunk.hashSchemaVersion !==
      MANIFEST_CHUNK_HASH_SCHEMA ||
    keywordInputs.length !== expectedKeywordCount
  ) {
    invalid();
  }

  const workspaceId = uuidV7(input.workspaceId);
  const projectId = uuidV7(input.projectId);
  const actorId = uuidV7(input.actorId);
  const jobId = uuidV7(input.jobId);
  const jobItemId = uuidV7(input.jobItemId);
  const estimateId = uuidV7(input.estimateId);
  const manifestId = uuidV7(manifest.id);
  const manifestChunkManifestId = uuidV7(
    manifestChunk.manifestId
  );
  const keywords = keywordInputs.map((keyword, index) =>
    intentKeyword(
      keyword,
      chunkIndex * providerPolicy.chunkSize + index,
      providerPolicy.maximumPairs
    )
  );
  assertUniqueIntentKeywords(keywords);

  if (manifestChunkManifestId !== manifestId) invalid();

  const result: RankProviderRequestIntentV1 = {
    schemaVersion: RANK_PROVIDER_REQUEST_INTENT_SCHEMA,
    workspaceId,
    projectId,
    actorId,
    jobId,
    jobItemId,
    estimateId,
    provider: input.provider,
    operation: "POSITIONS",
    project: {
      domain: boundedText(project.domain, 1, 2_048),
      version: positiveInteger(project.version)
    },
    execution: parseRankExecutionParameters(input.execution),
    manifest: {
      id: manifestId,
      hashSchemaVersion: MANIFEST_HASH_SCHEMA,
      manifestHash: hash(manifest.manifestHash),
      pairCount
    },
    manifestChunk: {
      manifestId: manifestChunkManifestId,
      chunkIndex,
      hashSchemaVersion: MANIFEST_CHUNK_HASH_SCHEMA,
      chunkHash: hash(manifestChunk.chunkHash)
    },
    executionConnectorVersion: version(
      input.executionConnectorVersion
    ),
    providerPolicyVersion: providerPolicy.version,
    keywords
  };

  // Also rejects lone surrogates and other non-I-JSON values before callers
  // can persist a snapshot that the hash function cannot reproduce.
  canonicalizeJson(result);
  return result;
}

export function rankProviderRequestIntentCanonicalJson(
  value: unknown
): string {
  return canonicalizeJson(rankProviderRequestIntent(value));
}

export function rankProviderRequestIntentHash(
  value: unknown
): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(
      RANK_PROVIDER_REQUEST_INTENT_SCHEMA,
      rankProviderRequestIntent(value)
    )
  };
}

function manifestCommand(
  value: unknown,
  providerPolicy: RankProviderIntentBounds
): InternalSealRankManifestInput {
  const hasProviderPolicy =
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "providerPolicyVersion");
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "estimateId",
    ...(hasProviderPolicy ? ["providerPolicyVersion"] : []),
    "provider",
    "operation",
    "project",
    "estimate",
    "execution",
    "retention"
  ]);
  const project = exactRecord(input.project, [
    "id",
    "workspaceId",
    "domain",
    "status",
    "version"
  ]);
  const estimate = exactRecord(input.estimate, [
    "trackingContextId",
    "contextVersion",
    "configurationVersion",
    "configurationHash",
    "semanticScopeHash",
    "scopeHash",
    "pairCount",
    "expiresAt"
  ]);
  const retention = exactRecord(input.retention, [
    "normalizedRankHistory",
    "rawSerp"
  ]);
  const workspaceId = uuidV7(input.workspaceId);
  const projectId = uuidV7(input.projectId);
  const actorId = uuidV7(input.actorId);
  const jobId = uuidV7(input.jobId);
  const estimateId = uuidV7(input.estimateId);
  const projectSnapshotId = uuidV7(project.id);
  const projectSnapshotWorkspaceId = uuidV7(project.workspaceId);
  const contextVersion = positiveInteger(estimate.contextVersion);
  const configurationVersion = positiveInteger(
    estimate.configurationVersion
  );

  if (
    (input.provider !== "ARSENKIN" && input.provider !== "XMLSTOCK") ||
    (hasProviderPolicy &&
      input.providerPolicyVersion !== providerPolicy.version) ||
    input.operation !== "POSITIONS" ||
    projectSnapshotId !== projectId ||
    projectSnapshotWorkspaceId !== workspaceId ||
    project.status !== "ACTIVE" ||
    configurationVersion > contextVersion ||
    retention.normalizedRankHistory !== "LONG_TERM" ||
    retention.rawSerp !== "NOT_COLLECTED"
  ) {
    invalid();
  }

  const result: InternalSealRankManifestInput = {
    workspaceId,
    projectId,
    actorId,
    jobId,
    estimateId,
    ...(hasProviderPolicy
      ? { providerPolicyVersion: providerPolicy.version }
      : {}),
    provider: input.provider,
    operation: "POSITIONS",
    project: {
      id: projectSnapshotId,
      workspaceId: projectSnapshotWorkspaceId,
      domain: boundedText(project.domain, 1, 2_048),
      status: "ACTIVE",
      version: positiveInteger(project.version)
    },
    estimate: {
      trackingContextId: uuidV7(estimate.trackingContextId),
      contextVersion,
      configurationVersion,
      configurationHash: hash(estimate.configurationHash),
      semanticScopeHash: hash(estimate.semanticScopeHash),
      scopeHash: hash(estimate.scopeHash),
      pairCount: decimal(
        estimate.pairCount,
        providerPolicy.maximumPairs
      ),
      expiresAt: timestamp(estimate.expiresAt)
    },
    execution: parseRankExecutionParameters(input.execution),
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    }
  };
  canonicalizeJson(result);
  return result;
}

function manifestChunk(
  value: unknown,
  pairCount: number,
  providerPolicy: RankProviderIntentBounds
): InternalRankManifestChunk {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "jobId",
    "manifestId",
    "chunkIndex",
    "hashSchemaVersion",
    "chunkHash",
    "entries"
  ]);
  const chunkIndex = boundedInteger(
    input.chunkIndex,
    0,
    providerPolicy.maximumChunkIndex
  );
  const entryInputs = exactArray(
    input.entries,
    1,
    providerPolicy.chunkSize
  );
  if (
    input.hashSchemaVersion !== MANIFEST_CHUNK_HASH_SCHEMA ||
    entryInputs.length !==
      expectedChunkEntryCount(
        pairCount,
        chunkIndex,
        providerPolicy
      )
  ) {
    invalid();
  }
  const entries = entryInputs.map((entry, index) =>
    manifestEntry(
      entry,
      chunkIndex * providerPolicy.chunkSize + index,
      providerPolicy.maximumPairs
    )
  );
  assertUniqueManifestEntries(entries);

  const result: InternalRankManifestChunk = {
    workspaceId: uuidV7(input.workspaceId),
    projectId: uuidV7(input.projectId),
    jobId: uuidV7(input.jobId),
    manifestId: uuidV7(input.manifestId),
    chunkIndex,
    hashSchemaVersion: MANIFEST_CHUNK_HASH_SCHEMA,
    chunkHash: hash(input.chunkHash),
    entries
  };
  const expectedHash = canonicalJsonSha256(
    MANIFEST_CHUNK_HASH_SCHEMA,
    rankManifestChunkHashPreimage(result)
  );
  if (result.chunkHash.value !== expectedHash) invalid();
  return result;
}

function manifestEntry(
  value: unknown,
  expectedSequence: number,
  maximumPairs: number
): InternalRankManifestEntry {
  const input = exactRecord(value, [
    "id",
    "sequence",
    "assignmentId",
    "keywordId",
    "keywordVersion",
    "keywordText",
    "keywordTextHash",
    "language"
  ]);
  const sequence = boundedInteger(input.sequence, 0, maximumPairs - 1);
  const keywordText = boundedKeywordText(input.keywordText);
  const keywordTextHash = hash(input.keywordTextHash);
  if (
    sequence !== expectedSequence ||
    keywordTextHash.value !== utf8Sha256(keywordText)
  ) {
    invalid();
  }
  return {
    id: uuidV7(input.id),
    sequence,
    assignmentId: uuidV7(input.assignmentId),
    keywordId: uuidV7(input.keywordId),
    keywordVersion: positiveInteger(input.keywordVersion),
    keywordText,
    keywordTextHash,
    language: canonicalLanguage(input.language)
  };
}

function intentKeyword(
  value: unknown,
  expectedSequence: number,
  maximumPairs: number
): RankProviderRequestIntentKeywordV1 {
  const input = exactRecord(value, [
    "manifestEntryId",
    "sequence",
    "keywordId",
    "keywordText",
    "keywordTextHash",
    "language"
  ]);
  const sequence = boundedInteger(input.sequence, 0, maximumPairs - 1);
  const keywordText = boundedKeywordText(input.keywordText);
  const keywordTextHash = hash(input.keywordTextHash);
  if (
    sequence !== expectedSequence ||
    keywordTextHash.value !== utf8Sha256(keywordText)
  ) {
    invalid();
  }
  return {
    manifestEntryId: uuidV7(input.manifestEntryId),
    sequence,
    keywordId: uuidV7(input.keywordId),
    keywordText,
    keywordTextHash,
    language: canonicalLanguage(input.language)
  };
}

function assertUniqueManifestEntries(
  entries: readonly InternalRankManifestEntry[]
): void {
  assertUnique(entries.map((entry) => entry.id));
  assertUnique(entries.map((entry) => entry.assignmentId));
  assertUnique(entries.map((entry) => entry.keywordId));
}

function assertUniqueIntentKeywords(
  entries: readonly RankProviderRequestIntentKeywordV1[]
): void {
  assertUnique(entries.map((entry) => entry.manifestEntryId));
  assertUnique(entries.map((entry) => entry.keywordId));
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalid();
}

function expectedChunkEntryCount(
  pairCount: number,
  chunkIndex: number,
  providerPolicy: RankProviderIntentBounds
): number {
  const firstSequence = chunkIndex * providerPolicy.chunkSize;
  if (
    !Number.isSafeInteger(pairCount) ||
    pairCount < 1 ||
    pairCount > providerPolicy.maximumPairs ||
    firstSequence >= pairCount
  ) {
    invalid();
  }
  return Math.min(
    providerPolicy.chunkSize,
    pairCount - firstSequence
  );
}

function rankProviderPolicy(value: unknown): RankProviderIntentBounds {
  const shape = rankExecutionPolicyShape(value);
  if (!shape || typeof value !== "string") invalid();
  return { version: value, maximumPairs: shape.commandLimit, chunkSize: shape.chunkSize, maximumChunkIndex: Math.ceil(shape.commandLimit / shape.chunkSize) - 1 };
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    nodeTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  const names = Object.getOwnPropertyNames(input);
  const allowed = new Set(fields);
  if (
    names.length !== fields.length ||
    names.some((field) => !allowed.has(field)) ||
    fields.some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      return (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      );
    })
  ) {
    invalid();
  }
  return input;
}

function exactArray(
  value: unknown,
  minimum: number,
  maximum: number
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    nodeTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    !Number.isSafeInteger(value.length) ||
    value.length < minimum ||
    value.length > maximum ||
    Object.getOwnPropertyNames(value).length !== value.length + 1
  ) {
    invalid();
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(
      value,
      String(index)
    );
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) {
      invalid();
    }
  }
  return value;
}

function uuidV7(value: unknown): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    invalid();
  }
  return value;
}

function hash(value: unknown): RankManifestHash {
  const input = exactRecord(value, ["algorithm", "value"]);
  if (
    input.algorithm !== "SHA_256" ||
    typeof input.value !== "string" ||
    !HASH_PATTERN.test(input.value)
  ) {
    invalid();
  }
  return { algorithm: "SHA_256", value: input.value };
}

function version(value: unknown): string {
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) {
    invalid();
  }
  return value;
}

function positiveInteger(value: unknown): number {
  return boundedInteger(value, 1, 2_147_483_647);
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    invalid();
  }
  return Number(value);
}

function decimal(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    invalid();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) invalid();
  return value;
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value !== value.trim()
  ) {
    invalid();
  }
  return value;
}

function boundedKeywordText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 1_000 ||
    Array.from(value).length > 500 ||
    Buffer.byteLength(value, "utf8") > 2_000
  ) {
    invalid();
  }
  return value;
}

function canonicalLanguage(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 16
  ) {
    invalid();
  }
  try {
    if (Intl.getCanonicalLocales(value)[0] !== value) invalid();
  } catch {
    invalid();
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid();
  }
  return value;
}

function invalid(): never {
  throw new TypeError("Invalid rank provider request intent");
}
