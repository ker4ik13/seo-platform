import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalFinalizeRankCheckInput,
  InternalRankCheckFinalizationReceipt,
  InternalRankExecutionParameters,
  InternalRankManifestSeal,
  InternalRankRunProjectSnapshot,
  InternalSealRankManifestInput,
  RankManifestHash
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  canonicalizeJson
} from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const RESPONSE_MAX_BYTES = 64 * 1_024;

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

  private async request(
    path: string,
    body: unknown,
    context: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
    }
  ): Promise<unknown> {
    const token = this.config.rankManifestApiToken;
    if (!token) {
      throw new RankManifestClientError("UNAVAILABLE", true);
    }
    let response: Response;
    try {
      response = await fetch(
        new URL(path, this.config.services.seoData),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Rank-Execution-Token": token,
            "X-Workspace-Id": context.workspaceId,
            "X-Project-Id": context.projectId,
            "X-Actor-Id": context.actorId
          },
          body: JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(
            this.config.internalCommandTimeoutMs
          )
        }
      );
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
        Number(contentLength) > RESPONSE_MAX_BYTES)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new RankManifestClientError("UNAVAILABLE", true);
    }
    const payload = await boundedJson(response, RESPONSE_MAX_BYTES);
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
  const pairCount = input ? decimal(input.pairCount, 1_000) : undefined;
  const persistedCount = input
    ? decimalAllowZero(input.persistedCount, 1_000)
    : undefined;
  const foundCount = input
    ? decimalAllowZero(input.foundCount, 1_000)
    : undefined;
  const notFoundCount = input
    ? decimalAllowZero(input.notFoundCount, 1_000)
    : undefined;
  const missingCount = input
    ? decimalAllowZero(input.missingCount, 1_000)
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
    persistedCount !== "0" ||
    foundCount !== "0" ||
    notFoundCount !== "0" ||
    missingCount !== pairCount ||
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
  const pairCount = decimal(input.pairCount, 1_000);
  const chunkCount = decimal(input.chunkCount, 4);
  if (
    !uuid(input.id) ||
    input.workspaceId !== command.workspaceId ||
    input.projectId !== command.projectId ||
    input.jobId !== command.jobId ||
    input.estimateId !== command.estimateId ||
    input.estimateExpiresAt !== command.estimate.expiresAt ||
    input.sealedBy !== command.actorId ||
    input.trackingContextId !== command.estimate.trackingContextId ||
    input.provider !== "ARSENKIN" ||
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
    pairCount !== command.estimate.pairCount ||
    chunkCount !== String(Math.ceil(Number(pairCount) / 250)) ||
    input.chunkSize !== "250" ||
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
    provider: "ARSENKIN",
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
    chunkSize: "250",
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
    input.searchEngine !== "GOOGLE" ||
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
    input.depth !== 30 ||
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
    searchEngine: "GOOGLE",
    countryCode: input.countryCode,
    ...("regionCode" in input
      ? { regionCode: input.regionCode as string }
      : {}),
    language: input.language,
    device: input.device as InternalRankExecutionParameters["device"],
    depth: 30,
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
    fields.every((field) => field in input)
  );
}

function record(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
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

function positiveInteger(value: unknown): boolean {
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
