import { Inject, Injectable } from "@nestjs/common";
import {
  legacyRankManifestChunkSize,
  legacyRankProviderKeywordLimit,
  rankManifestSingleTaskChunkSize,
  rankProviderKeywordLimit,
  xmlStockRankManifestChunkSize,
  rankManifestChunkHashPreimage,
  type InternalFinalizeRankCheckInput,
  type InternalGetRankManifestChunkInput,
  type InternalRankCheckFinalizationReceipt,
  type InternalRankExecutionParameters,
  type InternalRankManifestChunk,
  type InternalRankManifestEntry,
  type InternalRankManifestSeal,
  type InternalRankRunProjectSnapshot,
  type InternalSealRankManifestInput,
  type RankCheckFinalStatus,
  type RankManifestHash
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  canonicalizeJson,
  utf8Sha256
} from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const RESPONSE_MAX_BYTES = 64 * 1_024;
const CHUNK_RESPONSE_MAX_BYTES = 64 * 1_024 * 1_024;
const MAX_MANIFEST_CHUNK_INDEX = rankProviderKeywordLimit - 1;
const MAX_KEYWORD_CODE_POINTS = 500;
const MAX_KEYWORD_CODE_UNITS = MAX_KEYWORD_CODE_POINTS * 2;
const MAX_KEYWORD_UTF8_BYTES = 2_000;
const MAX_LANGUAGE_LENGTH = 16;

export type RankManifestClientErrorCode =
  | "INVALID_COMMAND"
  | "NOT_FOUND"
  | "ESTIMATE_EXPIRED"
  | "ESTIMATE_STALE"
  | "EQUIVALENT_RUN_ACTIVE"
  | "IDEMPOTENCY_CONFLICT"
  | "RANK_FINALIZATION_CONFLICT"
  | "RANK_MANIFEST_NOT_SEALED"
  | "RANK_INGEST_NOT_READY"
  | "UNAVAILABLE";

export class RankManifestClientError extends Error {
  public constructor(
    public readonly code: RankManifestClientErrorCode,
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "RankManifestClientError";
  }
}

@Injectable()
export class RankManifestClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async seal(
    input: InternalSealRankManifestInput
  ): Promise<InternalRankManifestSeal> {
    const response = await this.request(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/rank-manifests`,
      input,
      input
    );
    const seal = rankManifestSeal(response, input);
    if (!seal) {
      throw new RankManifestClientError("UNAVAILABLE", true);
    }
    return seal;
  }

  public async getChunk(
    input: InternalGetRankManifestChunkInput,
    actorId: string
  ): Promise<InternalRankManifestChunk> {
    const command = rankManifestChunkRequest(input, actorId);
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(command.input.projectId)}/rank-manifests/${encodeURIComponent(command.input.manifestId)}/chunks/${command.input.chunkIndex}`,
      this.config.services.seoData
    );
    url.searchParams.set("jobId", command.input.jobId);
    const response = await this.read(url, {
      workspaceId: command.input.workspaceId,
      projectId: command.input.projectId,
      actorId: command.actorId
    });
    const chunk = rankManifestChunk(response, command.input);
    if (!chunk) {
      throw new RankManifestClientError("UNAVAILABLE", true);
    }
    return chunk;
  }

  public async finalize(
    input: InternalFinalizeRankCheckInput,
    expected: {
      readonly trackingContextId: string;
      readonly configurationVersion: number;
      readonly pairCount: number;
    }
  ): Promise<InternalRankCheckFinalizationReceipt> {
    const response = await this.request(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/rank-manifests/${encodeURIComponent(input.manifestId)}/finalize`,
      input,
      input
    );
    const receipt = rankFinalizationReceipt(response, input, expected);
    if (!receipt) {
      throw new RankManifestClientError("UNAVAILABLE", true);
    }
    return receipt;
  }

  private async read(
    url: URL,
    context: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
    }
  ): Promise<unknown> {
    return this.send(
      "GET",
      url,
      context,
      CHUNK_RESPONSE_MAX_BYTES
    );
  }

  private async request(
    path: string,
    body: unknown,
    context: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
    }
  ): Promise<unknown> {
    return this.send(
      "POST",
      new URL(path, this.config.services.seoData),
      context,
      RESPONSE_MAX_BYTES,
      body
    );
  }

  private async send(
    method: "GET" | "POST",
    url: URL,
    context: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
    },
    maximumBytes: number,
    body?: unknown
  ): Promise<unknown> {
    const token = this.config.rankManifestApiToken;
    if (!token) {
      throw new RankManifestClientError("UNAVAILABLE", true);
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Rank-Execution-Token": token,
      "X-Workspace-Id": context.workspaceId,
      "X-Project-Id": context.projectId,
      "X-Actor-Id": context.actorId
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(
          this.config.internalCommandTimeoutMs
        )
      });
    } catch {
      throw new RankManifestClientError("UNAVAILABLE", true);
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      await response.body?.cancel().catch(() => undefined);
      throw new RankManifestClientError("UNAVAILABLE", true);
    }
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^(?:0|[1-9]\d*)$/u.test(contentLength) ||
        Number(contentLength) > maximumBytes)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new RankManifestClientError("UNAVAILABLE", true);
    }
    const payload = await boundedJson(response, maximumBytes);
    if (!response.ok) {
      throw responseError(response.status, payload);
    }
    const envelope = exactRecord(payload, ["data", "meta"]);
    const meta = envelope
      ? exactRecord(envelope.meta, ["requestId"])
      : undefined;
    if (
      !envelope ||
      !meta ||
      typeof meta.requestId !== "string" ||
      meta.requestId.length < 1 ||
      meta.requestId.length > 200
    ) {
      throw new RankManifestClientError("UNAVAILABLE", true);
    }
    return envelope.data;
  }
}

function rankManifestChunkRequest(
  value: InternalGetRankManifestChunkInput,
  actorId: string
): {
  readonly input: InternalGetRankManifestChunkInput;
  readonly actorId: string;
} {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "jobId",
    "manifestId",
    "chunkIndex"
  ]);
  if (
    !input ||
    !uuidV7(input.workspaceId) ||
    !uuidV7(input.projectId) ||
    !uuidV7(input.jobId) ||
    !uuidV7(input.manifestId) ||
    !chunkIndex(input.chunkIndex) ||
    !uuidV7(actorId)
  ) {
    throw new RankManifestClientError("INVALID_COMMAND", false);
  }
  return {
    input: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      jobId: input.jobId,
      manifestId: input.manifestId,
      chunkIndex: input.chunkIndex
    },
    actorId
  };
}

function rankManifestChunk(
  value: unknown,
  command: InternalGetRankManifestChunkInput
): InternalRankManifestChunk | undefined {
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
  const chunkHash = input ? manifestHash(input.chunkHash) : undefined;
  if (
    !input ||
    !uuidV7(input.workspaceId) ||
    !uuidV7(input.projectId) ||
    !uuidV7(input.jobId) ||
    !uuidV7(input.manifestId) ||
    input.workspaceId !== command.workspaceId ||
    input.projectId !== command.projectId ||
    input.jobId !== command.jobId ||
    input.manifestId !== command.manifestId ||
    input.chunkIndex !== command.chunkIndex ||
    !chunkIndex(input.chunkIndex) ||
    input.hashSchemaVersion !== "rank-manifest-chunk@1" ||
    !chunkHash ||
    !Array.isArray(input.entries) ||
    input.entries.length < 1 ||
    input.entries.length >
      (input.chunkIndex === 0
        ? rankManifestSingleTaskChunkSize
        : legacyRankManifestChunkSize)
  ) {
    return undefined;
  }

  const entries: InternalRankManifestEntry[] = [];
  const entryIds = new Set<string>();
  const assignmentIds = new Set<string>();
  const keywordIds = new Set<string>();
  const firstSequence = exactRecord(input.entries[0], [
    "id",
    "sequence",
    "assignmentId",
    "keywordId",
    "keywordVersion",
    "keywordText",
    "keywordTextHash",
    "language"
  ])?.sequence;
  const sequenceBase =
    input.entries.length === 1 && firstSequence === input.chunkIndex
      ? input.chunkIndex
      : input.chunkIndex === 0
        ? 0
        : input.chunkIndex * legacyRankManifestChunkSize;
  for (let offset = 0; offset < input.entries.length; offset += 1) {
    const entry = rankManifestEntry(
      input.entries[offset],
      sequenceBase + offset
    );
    if (
      !entry ||
      entryIds.has(entry.id) ||
      assignmentIds.has(entry.assignmentId) ||
      keywordIds.has(entry.keywordId)
    ) {
      return undefined;
    }
    entryIds.add(entry.id);
    assignmentIds.add(entry.assignmentId);
    keywordIds.add(entry.keywordId);
    entries.push(entry);
  }

  const chunk: InternalRankManifestChunk = {
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    jobId: command.jobId,
    manifestId: command.manifestId,
    chunkIndex: command.chunkIndex,
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash,
    entries
  };
  try {
    const expectedHash = canonicalJsonSha256(
      "rank-manifest-chunk@1",
      rankManifestChunkHashPreimage(chunk)
    );
    return chunkHash.value === expectedHash ? chunk : undefined;
  } catch {
    return undefined;
  }
}

function rankManifestEntry(
  value: unknown,
  expectedSequence: number
): InternalRankManifestEntry | undefined {
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
  const keywordTextHash = input
    ? manifestHash(input.keywordTextHash)
    : undefined;
  if (
    !input ||
    !uuidV7(input.id) ||
    input.sequence !== expectedSequence ||
    !uuidV7(input.assignmentId) ||
    !uuidV7(input.keywordId) ||
    !positiveInteger(input.keywordVersion) ||
    !boundedKeywordText(input.keywordText) ||
    !keywordTextHash ||
    keywordTextHash.value !== utf8Sha256(input.keywordText) ||
    !canonicalLanguage(input.language)
  ) {
    return undefined;
  }
  return {
    id: input.id,
    sequence: expectedSequence,
    assignmentId: input.assignmentId,
    keywordId: input.keywordId,
    keywordVersion: input.keywordVersion,
    keywordText: input.keywordText,
    keywordTextHash,
    language: input.language
  };
}

function rankFinalizationReceipt(
  value: unknown,
  command: InternalFinalizeRankCheckInput,
  expected: {
    readonly trackingContextId: string;
    readonly configurationVersion: number;
    readonly pairCount: number;
  }
): InternalRankCheckFinalizationReceipt | undefined {
  const input = exactRecord(value, [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "jobId",
    "manifestId",
    "requestHash",
    "trackingContextId",
    "configurationVersion",
    "status",
    "pairCount",
    "persistedCount",
    "foundCount",
    "notFoundCount",
    "missingCount",
    "finalizedAt"
  ]);
  const requestHash = input ? manifestHash(input.requestHash) : undefined;
  const pairCount = input
    ? decimal(input.pairCount, rankProviderKeywordLimit)
    : undefined;
  const persistedCount = input
    ? decimalAllowZero(input.persistedCount, rankProviderKeywordLimit)
    : undefined;
  const foundCount = input
    ? decimalAllowZero(input.foundCount, rankProviderKeywordLimit)
    : undefined;
  const notFoundCount = input
    ? decimalAllowZero(input.notFoundCount, rankProviderKeywordLimit)
    : undefined;
  const missingCount = input
    ? decimalAllowZero(input.missingCount, rankProviderKeywordLimit)
    : undefined;
  const expectedHash = canonicalJsonSha256("rank-finalize@1", {
    schemaVersion: command.schemaVersion,
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    jobId: command.jobId,
    manifestId: command.manifestId,
    status: command.status
  });
  if (
    !input ||
    input.schemaVersion !== "rank-finalize@1" ||
    input.workspaceId !== command.workspaceId ||
    input.projectId !== command.projectId ||
    input.jobId !== command.jobId ||
    input.manifestId !== command.manifestId ||
    !requestHash ||
    requestHash.value !== expectedHash ||
    input.trackingContextId !== expected.trackingContextId ||
    input.configurationVersion !== expected.configurationVersion ||
    input.status !== command.status ||
    pairCount !== String(expected.pairCount) ||
    persistedCount === undefined ||
    foundCount === undefined ||
    notFoundCount === undefined ||
    missingCount === undefined ||
    !finalizationCountsAreValid(
      input.status,
      pairCount,
      persistedCount,
      foundCount,
      notFoundCount,
      missingCount
    ) ||
    !timestamp(input.finalizedAt)
  ) {
    return undefined;
  }
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    jobId: command.jobId,
    manifestId: command.manifestId,
    requestHash,
    trackingContextId: expected.trackingContextId,
    configurationVersion: expected.configurationVersion,
    status: command.status,
    pairCount,
    persistedCount,
    foundCount,
    notFoundCount,
    missingCount,
    finalizedAt: input.finalizedAt as string
  };
}

function finalizationCountsAreValid(
  status: unknown,
  pairCount: string,
  persistedCount: string,
  foundCount: string,
  notFoundCount: string,
  missingCount: string
): status is RankCheckFinalStatus {
  const pair = Number(pairCount);
  const persisted = Number(persistedCount);
  const found = Number(foundCount);
  const notFound = Number(notFoundCount);
  const missing = Number(missingCount);
  if (
    found + notFound !== persisted ||
    missing !== pair - persisted ||
    persisted > pair
  ) {
    return false;
  }
  switch (status) {
    case "COMPLETED":
      return persisted === pair;
    case "PARTIALLY_COMPLETED":
      return persisted > 0 && persisted < pair;
    case "CANCELLED":
      return true;
    case "FAILED":
      return persisted === 0;
    case "ACTION_REQUIRED":
      return persisted < pair;
    default:
      return false;
  }
}

function validManifestShape(
  provider: unknown,
  pairCount: number,
  chunkCount: number,
  chunkSize: unknown
): boolean {
  if (chunkSize === String(legacyRankManifestChunkSize)) {
    return (
      pairCount >= 1 &&
      pairCount <= legacyRankProviderKeywordLimit &&
      chunkCount ===
        Math.ceil(pairCount / legacyRankManifestChunkSize)
    );
  }
  if (provider === "XMLSTOCK") {
    return (
      chunkSize === String(xmlStockRankManifestChunkSize) &&
      pairCount >= 1 &&
      pairCount <= rankProviderKeywordLimit &&
      chunkCount === pairCount
    );
  }
  return (
    provider === "ARSENKIN" &&
    chunkSize === String(rankManifestSingleTaskChunkSize) &&
    pairCount >= 1 &&
    pairCount <= rankProviderKeywordLimit &&
    chunkCount === 1
  );
}

function rankManifestSeal(
  value: unknown,
  command: InternalSealRankManifestInput
): InternalRankManifestSeal | undefined {
  const input = exactRecord(value, [
    "id",
    "workspaceId",
    "projectId",
    "jobId",
    "estimateId",
    "estimateExpiresAt",
    "sealedBy",
    "trackingContextId",
    "provider",
    "operation",
    "project",
    "contextVersion",
    "configurationVersion",
    "configurationHash",
    "semanticScopeHash",
    "scopeHash",
    "hashSchemaVersion",
    "manifestHash",
    "deduplicationHash",
    "pairCount",
    "chunkCount",
    "chunkSize",
    "execution",
    "retention",
    "status",
    "sealedAt"
  ]);
  if (!input) return undefined;
  const project = projectSnapshot(input.project);
  const configurationHash = manifestHash(input.configurationHash);
  const semanticScopeHash = manifestHash(input.semanticScopeHash);
  const scopeHash = manifestHash(input.scopeHash);
  const fullHash = manifestHash(input.manifestHash);
  const deduplicationHash = manifestHash(input.deduplicationHash);
  const execution = executionParameters(input.execution);
  const retention = exactRecord(input.retention, [
    "normalizedRankHistory",
    "rawSerp"
  ]);
  const pairCount = decimal(input.pairCount, rankProviderKeywordLimit);
  const chunkCount = decimal(input.chunkCount, rankProviderKeywordLimit);
  const validShape =
    pairCount !== undefined &&
    chunkCount !== undefined &&
    validManifestShape(
      input.provider,
      Number(pairCount),
      Number(chunkCount),
      input.chunkSize
    );
  if (
    !uuid(input.id) ||
    input.workspaceId !== command.workspaceId ||
    input.projectId !== command.projectId ||
    input.jobId !== command.jobId ||
    input.estimateId !== command.estimateId ||
    input.estimateExpiresAt !== command.estimate.expiresAt ||
    input.sealedBy !== command.actorId ||
    input.trackingContextId !== command.estimate.trackingContextId ||
    input.provider !== command.provider ||
    input.operation !== "POSITIONS" ||
    !project ||
    canonicalizeJson(project) !== canonicalizeJson(command.project) ||
    input.contextVersion !== command.estimate.contextVersion ||
    input.configurationVersion !==
      command.estimate.configurationVersion ||
    !hashEqual(configurationHash, command.estimate.configurationHash) ||
    !hashEqual(semanticScopeHash, command.estimate.semanticScopeHash) ||
    !hashEqual(scopeHash, command.estimate.scopeHash) ||
    input.hashSchemaVersion !== "rank-manifest@1" ||
    !fullHash ||
    !deduplicationHash ||
    pairCount === undefined ||
    chunkCount === undefined ||
    pairCount !== command.estimate.pairCount ||
    !validShape ||
    !execution ||
    canonicalizeJson(execution) !== canonicalizeJson(command.execution) ||
    !retention ||
    retention.normalizedRankHistory !== "LONG_TERM" ||
    retention.rawSerp !== "NOT_COLLECTED" ||
    input.status !== "SEALED" ||
    !timestamp(input.sealedAt) ||
    !timestamp(input.estimateExpiresAt) ||
    new Date(input.sealedAt as string).getTime() >=
      new Date(input.estimateExpiresAt as string).getTime()
  ) {
    return undefined;
  }
  return {
    id: input.id as string,
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    jobId: command.jobId,
    estimateId: command.estimateId,
    estimateExpiresAt: command.estimate.expiresAt,
    sealedBy: command.actorId,
    trackingContextId: command.estimate.trackingContextId,
    provider: command.provider,
    operation: "POSITIONS",
    project,
    contextVersion: command.estimate.contextVersion,
    configurationVersion: command.estimate.configurationVersion,
    configurationHash: configurationHash as RankManifestHash,
    semanticScopeHash: semanticScopeHash as RankManifestHash,
    scopeHash: scopeHash as RankManifestHash,
    hashSchemaVersion: "rank-manifest@1",
    manifestHash: fullHash,
    deduplicationHash,
    pairCount,
    chunkCount,
    chunkSize: input.chunkSize as "1" | "250" | "15000",
    execution,
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    },
    status: "SEALED",
    sealedAt: input.sealedAt as string
  };
}

function projectSnapshot(
  value: unknown
): InternalRankRunProjectSnapshot | undefined {
  const input = exactRecord(value, [
    "id",
    "workspaceId",
    "domain",
    "status",
    "version"
  ]);
  if (
    !input ||
    !uuid(input.id) ||
    !uuid(input.workspaceId) ||
    typeof input.domain !== "string" ||
    input.domain.length < 1 ||
    input.domain.length > 2_048 ||
    input.domain !== input.domain.trim() ||
    !["DRAFT", "ACTIVE", "ARCHIVED"].includes(String(input.status)) ||
    !positiveInteger(input.version)
  ) {
    return undefined;
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    domain: input.domain,
    status: input.status as InternalRankRunProjectSnapshot["status"],
    version: Number(input.version)
  };
}

function executionParameters(
  value: unknown
): InternalRankExecutionParameters | undefined {
  const input = exactRecord(value, [
    "searchEngine",
    "countryCode",
    ...(hasField(value, "regionCode") ? ["regionCode"] : []),
    "language",
    "device",
    "depth",
    "domainMatchRule",
    "safeSearch",
    "format",
    "rawSerp",
    "fallbackMode",
    "providerMappingVersion"
  ]);
  if (
    !input ||
    !["GOOGLE", "YANDEX"].includes(String(input.searchEngine)) ||
    typeof input.countryCode !== "string" ||
    !/^[A-Z]{2}$/u.test(input.countryCode) ||
    ("regionCode" in input &&
      (typeof input.regionCode !== "string" ||
        input.regionCode.length < 1 ||
        input.regionCode.length > 100)) ||
    typeof input.language !== "string" ||
    input.language.length < 1 ||
    input.language.length > 16 ||
    !["DESKTOP", "MOBILE"].includes(String(input.device)) ||
    ![30, 50, 100].includes(Number(input.depth)) ||
    typeof input.safeSearch !== "boolean" ||
    input.format !== "SIMPLE" ||
    input.rawSerp !== false ||
    input.fallbackMode !== "NONE" ||
    typeof input.providerMappingVersion !== "string" ||
    input.providerMappingVersion.length < 1 ||
    input.providerMappingVersion.length > 64
  ) {
    return undefined;
  }
  const rule = domainMatchRule(input.domainMatchRule);
  if (!rule) return undefined;
  return {
    searchEngine:
      input.searchEngine as InternalRankExecutionParameters["searchEngine"],
    countryCode: input.countryCode,
    ...("regionCode" in input
      ? { regionCode: input.regionCode as string }
      : {}),
    language: input.language,
    device: input.device as InternalRankExecutionParameters["device"],
    depth: input.depth as InternalRankExecutionParameters["depth"],
    domainMatchRule: rule,
    safeSearch: input.safeSearch,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion: input.providerMappingVersion
  };
}

function domainMatchRule(
  value: unknown
): InternalRankExecutionParameters["domainMatchRule"] | undefined {
  const input = record(value);
  if (!input || typeof input.mode !== "string") return undefined;
  if (input.mode === "SPECIFIC_URL" || input.mode === "URL_PREFIX") {
    if (
      !exactFields(input, ["mode", "value"]) ||
      typeof input.value !== "string" ||
      input.value.length < 1 ||
      input.value.length > 2_048 ||
      input.value !== input.value.trim()
    ) {
      return undefined;
    }
    return { mode: input.mode, value: input.value };
  }
  if (
    !exactFields(input, ["mode"]) ||
    ![
      "EXACT_HOST",
      "INCLUDE_WWW",
      "INCLUDE_SUBDOMAINS",
      "CANONICAL_DOMAIN",
      "ANY_PROJECT_MIRROR"
    ].includes(input.mode)
  ) {
    return undefined;
  }
  return {
    mode: input.mode as Exclude<
      InternalRankExecutionParameters["domainMatchRule"]["mode"],
      "SPECIFIC_URL" | "URL_PREFIX"
    >
  };
}

function manifestHash(value: unknown): RankManifestHash | undefined {
  const input = exactRecord(value, ["algorithm", "value"]);
  return input?.algorithm === "SHA_256" &&
    typeof input.value === "string" &&
    /^[a-f0-9]{64}$/u.test(input.value)
    ? { algorithm: "SHA_256", value: input.value }
    : undefined;
}

function hashEqual(
  left: RankManifestHash | undefined,
  right: RankManifestHash
): boolean {
  return left?.algorithm === right.algorithm && left.value === right.value;
}

function responseError(
  status: number,
  value: unknown
): RankManifestClientError {
  const envelope = record(value);
  const error = envelope ? exactRecord(envelope.error, ["code", "message"]) : undefined;
  const code = error?.code;
  if (
    status === 409 &&
    typeof code === "string" &&
    [
      "ESTIMATE_EXPIRED",
      "ESTIMATE_STALE",
      "EQUIVALENT_RUN_ACTIVE",
      "IDEMPOTENCY_CONFLICT",
      "RANK_FINALIZATION_CONFLICT",
      "RANK_MANIFEST_NOT_SEALED",
      "RANK_INGEST_NOT_READY"
    ].includes(code)
  ) {
    return new RankManifestClientError(
      code as Exclude<
        RankManifestClientErrorCode,
        "INVALID_COMMAND" | "NOT_FOUND" | "UNAVAILABLE"
      >,
      false
    );
  }
  if (status === 400 || status === 422) {
    return new RankManifestClientError("INVALID_COMMAND", false);
  }
  if (status === 404) {
    return new RankManifestClientError("NOT_FOUND", false);
  }
  return new RankManifestClientError("UNAVAILABLE", true);
}

async function boundedJson(
  response: Response,
  maximumBytes: number
): Promise<unknown> {
  if (!response.body) {
    throw new RankManifestClientError("UNAVAILABLE", true);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new RankManifestClientError("UNAVAILABLE", true);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RankManifestClientError) throw error;
    throw new RankManifestClientError("UNAVAILABLE", true);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
  } catch {
    throw new RankManifestClientError("UNAVAILABLE", true);
  }
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  const input = record(value);
  return input && exactFields(input, fields) ? input : undefined;
}

function exactFields(
  input: Readonly<Record<string, unknown>>,
  fields: readonly string[]
): boolean {
  const allowed = new Set(fields);
  return (
    Object.keys(input).length === fields.length &&
    Object.keys(input).every((field) => allowed.has(field)) &&
    fields.every((field) => Object.hasOwn(input, field))
  );
}

function record(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(value);
    if (
      Object.getOwnPropertyNames(value).length !== keys.length ||
      Object.values(descriptors).some(
        (descriptor) =>
          !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
      )
    ) {
      return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }
}

function hasField(value: unknown, field: string): boolean {
  return record(value)?.[field] !== undefined;
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  );
}

function uuidV7(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  );
}

function chunkIndex(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= MAX_MANIFEST_CHUNK_INDEX
  );
}

function boundedKeywordText(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_KEYWORD_CODE_UNITS
  ) {
    return false;
  }
  let codePointCount = 0;
  for (const codePoint of value) {
    codePointCount += codePoint.length > 0 ? 1 : 0;
    if (codePointCount > MAX_KEYWORD_CODE_POINTS) return false;
  }
  return (
    new TextEncoder().encode(value).byteLength <= MAX_KEYWORD_UTF8_BYTES
  );
}

function canonicalLanguage(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_LANGUAGE_LENGTH
  ) {
    return false;
  }
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function decimal(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum
    ? value
    : undefined;
}

function decimalAllowZero(
  value: unknown,
  maximum: number
): string | undefined {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum
    ? value
    : undefined;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
  );
}
