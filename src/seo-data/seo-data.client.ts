import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalApplySemanticImportChunkInput,
  InternalBeginSemanticImportInput,
  InternalCompleteSemanticImportInput,
  InternalNormalizeSemanticKeywordsInput,
  InternalNormalizedSemanticKeyword,
  InternalNormalizeSemanticKeywordsResult,
  InternalRankEstimateScope,
  InternalRankEstimateScopeQuery,
  InternalSemanticImportChunkResult,
  InternalSemanticImportReceipt,
  SemanticImportResultSummary,
  TrackingContextConfigurationInput
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

export class SeoDataClientError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_COMMAND"
      | "CONFLICT"
      | "NOT_FOUND"
      | "UNAVAILABLE",
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "SeoDataClientError";
  }
}

@Injectable()
export class SeoDataClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async normalizeKeywords(
    input: InternalNormalizeSemanticKeywordsInput
  ): Promise<InternalNormalizeSemanticKeywordsResult> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/normalize`,
      input
    );
    const result = normalizedKeywords(payload);
    if (
      !result ||
      result.rows.length !== input.rows.length ||
      new Set(result.rows.map(({ rowNumber }) => rowNumber)).size !==
        input.rows.length ||
      result.rows.some(
        ({ rowNumber }) =>
          !input.rows.some((row) => row.rowNumber === rowNumber)
      )
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async beginImport(
    input: InternalBeginSemanticImportInput
  ): Promise<InternalSemanticImportReceipt> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/begin`,
      input
    );
    const result = importReceipt(payload);
    if (!result || result.importId !== input.importId) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async applyChunk(
    input: InternalApplySemanticImportChunkInput
  ): Promise<InternalSemanticImportChunkResult> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/chunks`,
      input
    );
    const result = chunkResult(payload);
    if (!result || result.chunkIndex !== input.chunkIndex) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async completeImport(
    input: InternalCompleteSemanticImportInput
  ): Promise<SemanticImportResultSummary> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/complete`,
      input
    );
    const result = importResult(payload);
    if (!result) throw new SeoDataClientError("UNAVAILABLE", true);
    return result;
  }

  public async rankEstimateScope(
    input: InternalRankEstimateScopeQuery
  ): Promise<InternalRankEstimateScope> {
    const payload = await this.requestStrictRankScope(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/rank-estimate-scopes`,
      input
    );
    const result = rankEstimateScope(payload);
    if (
      !result ||
      result.workspaceId !== input.workspaceId ||
      result.projectId !== input.projectId ||
      result.trackingContextId !== input.trackingContextId
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  private async request(
    path: string,
    body: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
    }
  ): Promise<unknown> {
    const response = await this.fetch(path, body);
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw clientError(response.status);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload)
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return payload.data;
  }

  private async requestStrictRankScope(
    path: string,
    body: InternalRankEstimateScopeQuery
  ): Promise<unknown> {
    const response = await this.fetch(path, body);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw clientError(response.status);
    }
    if (
      response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^(?:0|[1-9]\d*)$/u.test(contentLength) ||
        Number(contentLength) > RANK_SCOPE_RESPONSE_MAX_BYTES)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const payload = object(
      await boundedJson(response, RANK_SCOPE_RESPONSE_MAX_BYTES)
    );
    if (!payload) throw new SeoDataClientError("UNAVAILABLE", true);
    const envelopeFields = Object.keys(payload);
    if (
      envelopeFields.length !== 2 ||
      !envelopeFields.includes("data") ||
      !envelopeFields.includes("meta")
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const meta = exactObject(payload.meta, ["requestId"]);
    if (
      !meta ||
      typeof meta.requestId !== "string" ||
      meta.requestId.length < 1 ||
      meta.requestId.length > 200
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return payload.data;
  }

  private async fetch(
    path: string,
    body: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
    }
  ): Promise<Response> {
    const token = this.config.internalApiToken;
    if (!token) throw new SeoDataClientError("UNAVAILABLE", true);
    try {
      return await fetch(new URL(path, this.config.services.seoData), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Internal-Token": token,
          "X-Workspace-Id": body.workspaceId,
          "X-Project-Id": body.projectId,
          "X-Actor-Id": body.actorId
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.internalCommandTimeoutMs)
      });
    } catch {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
  }
}

const RANK_SCOPE_RESPONSE_MAX_BYTES = 64 * 1_024;

function clientError(status: number): SeoDataClientError {
  if (status === 400 || status === 422) {
    return new SeoDataClientError("INVALID_COMMAND", false);
  }
  if (status === 404) {
    return new SeoDataClientError("NOT_FOUND", false);
  }
  if (status === 409) {
    return new SeoDataClientError("CONFLICT", false);
  }
  return new SeoDataClientError("UNAVAILABLE", true);
}

function normalizedKeywords(
  value: unknown
): InternalNormalizeSemanticKeywordsResult | undefined {
  const payload = object(value);
  if (!payload || !Array.isArray(payload.rows)) return undefined;
  const rows: InternalNormalizedSemanticKeyword[] = [];
  for (const value of payload.rows) {
    const row = object(value);
    if (
      !row ||
      !strings(
        row,
        "rowNumber",
        "textOriginal",
        "textNormalized",
        "normalizedHash",
        "language"
      ) ||
      typeof row.existsInProject !== "boolean" ||
      !/^[a-f0-9]{64}$/u.test(row.normalizedHash as string)
    ) {
      return undefined;
    }
    rows.push(row as unknown as InternalNormalizedSemanticKeyword);
  }
  return { rows };
}

function importReceipt(
  value: unknown
): InternalSemanticImportReceipt | undefined {
  const payload = object(value);
  if (
    !payload ||
    typeof payload.importId !== "string" ||
    !["RECEIVING", "COMPLETED"].includes(String(payload.status)) ||
    !nonNegativeInteger(payload.receivedChunks) ||
    !nonNegativeInteger(payload.expectedChunks)
  ) {
    return undefined;
  }
  return payload as unknown as InternalSemanticImportReceipt;
}

function chunkResult(
  value: unknown
): InternalSemanticImportChunkResult | undefined {
  const payload = object(value);
  if (
    !payload ||
    !nonNegativeInteger(payload.chunkIndex) ||
    !strings(
      payload,
      "createdKeywords",
      "updatedKeywords",
      "skippedKeywords",
      "createdGroups",
      "createdPages",
      "createdTags",
      "createdMetricSnapshots"
    )
  ) {
    return undefined;
  }
  return payload as unknown as InternalSemanticImportChunkResult;
}

function importResult(
  value: unknown
): SemanticImportResultSummary | undefined {
  const payload = object(value);
  if (
    !payload ||
    typeof payload.partial !== "boolean" ||
    !Number.isSafeInteger(payload.semanticVersionNumber) ||
    !strings(
      payload,
      "semanticVersionId",
      "createdKeywords",
      "updatedKeywords",
      "skippedKeywords",
      "createdGroups",
      "createdPages",
      "createdTags",
      "createdMetricSnapshots"
    )
  ) {
    return undefined;
  }
  return payload as unknown as SemanticImportResultSummary;
}

function rankEstimateScope(
  value: unknown
): InternalRankEstimateScope | undefined {
  const payload = exactObject(value, [
    "workspaceId",
    "projectId",
    "trackingContextId",
    "contextStatus",
    "contextVersion",
    "configurationVersion",
    "configurationHash",
    "configuration",
    "keywordCount",
    "contextCount",
    "pairCount",
    "semanticScopeHash",
    "calculatedAt"
  ]);
  if (
    !payload ||
    !uuid(payload.workspaceId) ||
    !uuid(payload.projectId) ||
    !uuid(payload.trackingContextId) ||
    !["ACTIVE", "ARCHIVED"].includes(String(payload.contextStatus)) ||
    !positiveInteger(payload.contextVersion) ||
    !positiveInteger(payload.configurationVersion) ||
    Number(payload.configurationVersion) > Number(payload.contextVersion) ||
    !sha256(payload.configurationHash) ||
    payload.contextCount !== "1" ||
    !boundedDecimal(payload.keywordCount, 1_001) ||
    payload.pairCount !== payload.keywordCount ||
    !isoTimestamp(payload.calculatedAt)
  ) {
    return undefined;
  }
  const configuration = trackingConfiguration(payload.configuration);
  const semanticScopeHash = scopeHash(payload.semanticScopeHash);
  if (
    !configuration ||
    !semanticScopeHash ||
    (payload.keywordCount === "1001") !==
      (semanticScopeHash.availability === "UNAVAILABLE")
  ) {
    return undefined;
  }
  return {
    workspaceId: payload.workspaceId as string,
    projectId: payload.projectId as string,
    trackingContextId: payload.trackingContextId as string,
    contextStatus:
      payload.contextStatus as InternalRankEstimateScope["contextStatus"],
    contextVersion: Number(payload.contextVersion),
    configurationVersion: Number(payload.configurationVersion),
    configurationHash: payload.configurationHash as string,
    configuration,
    keywordCount: payload.keywordCount as string,
    contextCount: "1",
    pairCount: payload.pairCount as string,
    semanticScopeHash,
    calculatedAt: payload.calculatedAt as string
  };
}

function trackingConfiguration(
  value: unknown
): TrackingContextConfigurationInput | undefined {
  const payload = object(value);
  if (!payload) return undefined;
  const domainMatchRule = trackingDomainMatchRule(payload.domainMatchRule);
  const optional = ["regionCode", "regionLabel"].filter(
    (field) => field in payload
  );
  const allowed = new Set([
    "searchEngine",
    "countryCode",
    "language",
    "device",
    "depth",
    "domainMatchRule",
    "safeSearch",
    ...optional
  ]);
  if (
    Object.keys(payload).some((field) => !allowed.has(field)) ||
    !["GOOGLE", "YANDEX"].includes(String(payload.searchEngine)) ||
    typeof payload.countryCode !== "string" ||
    !/^[A-Z]{2}$/u.test(payload.countryCode) ||
    !canonicalLanguage(payload.language) ||
    !["DESKTOP", "MOBILE"].includes(String(payload.device)) ||
    ![30, 50, 100].includes(Number(payload.depth)) ||
    typeof payload.safeSearch !== "boolean" ||
    !domainMatchRule ||
    !optionalString(payload, "regionCode", 100) ||
    !optionalString(payload, "regionLabel", 160) ||
    (typeof payload.regionLabel === "string" &&
      typeof payload.regionCode !== "string")
  ) {
    return undefined;
  }
  return {
    searchEngine:
      payload.searchEngine as TrackingContextConfigurationInput["searchEngine"],
    countryCode: payload.countryCode,
    ...(typeof payload.regionCode === "string"
      ? { regionCode: payload.regionCode }
      : {}),
    ...(typeof payload.regionLabel === "string"
      ? { regionLabel: payload.regionLabel }
      : {}),
    language: payload.language,
    device: payload.device as TrackingContextConfigurationInput["device"],
    depth: Number(payload.depth) as TrackingContextConfigurationInput["depth"],
    domainMatchRule,
    safeSearch: payload.safeSearch
  };
}

function trackingDomainMatchRule(
  value: unknown
): TrackingContextConfigurationInput["domainMatchRule"] | undefined {
  const payload = object(value);
  if (!payload || typeof payload.mode !== "string") return undefined;
  if (["SPECIFIC_URL", "URL_PREFIX"].includes(payload.mode)) {
    if (
      Object.keys(payload).length !== 2 ||
      typeof payload.value !== "string" ||
      payload.value !== payload.value.trim() ||
      payload.value.length < 1 ||
      payload.value.length > 2_048
    ) {
      return undefined;
    }
    return {
      mode: payload.mode as "SPECIFIC_URL" | "URL_PREFIX",
      value: payload.value
    };
  }
  if (
    Object.keys(payload).length !== 1 ||
    ![
      "EXACT_HOST",
      "INCLUDE_WWW",
      "INCLUDE_SUBDOMAINS",
      "CANONICAL_DOMAIN",
      "ANY_PROJECT_MIRROR"
    ].includes(payload.mode)
  ) {
    return undefined;
  }
  return {
    mode: payload.mode as Exclude<
      TrackingContextConfigurationInput["domainMatchRule"]["mode"],
      "SPECIFIC_URL" | "URL_PREFIX"
    >
  };
}

function scopeHash(
  value: unknown
): InternalRankEstimateScope["semanticScopeHash"] | undefined {
  const payload = object(value);
  if (
    !payload ||
    !["AVAILABLE", "UNAVAILABLE"].includes(String(payload.availability))
  ) {
    return undefined;
  }
  if (payload.availability === "UNAVAILABLE") {
    return Object.keys(payload).length === 1
      ? { availability: "UNAVAILABLE" }
      : undefined;
  }
  return Object.keys(payload).length === 3 &&
    payload.algorithm === "SHA_256" &&
    sha256(payload.value)
    ? {
        availability: "AVAILABLE",
        algorithm: "SHA_256",
        value: payload.value as string
      }
    : undefined;
}

function object(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function exactObject(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  const payload = object(value);
  if (!payload) return undefined;
  const allowed = new Set(fields);
  return Object.keys(payload).length === fields.length &&
    Object.keys(payload).every((field) => allowed.has(field)) &&
    fields.every((field) => field in payload)
    ? payload
    : undefined;
}

function strings(
  value: Readonly<Record<string, unknown>>,
  ...fields: readonly string[]
): boolean {
  return fields.every((field) => typeof value[field] === "string");
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function boundedDecimal(value: unknown, maximum: number): boolean {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return false;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum;
}

function sha256(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function uuid(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  );
}

function isoTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
  );
}

function optionalString(
  value: Readonly<Record<string, unknown>>,
  field: string,
  maximum: number
): boolean {
  return (
    !(field in value) ||
    (typeof value[field] === "string" &&
      value[field] === (value[field] as string).trim() &&
      (value[field] as string).length >= 1 &&
      (value[field] as string).length <= maximum)
  );
}

function canonicalLanguage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 16) return false;
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

async function boundedJson(
  response: Response,
  maximumBytes: number
): Promise<unknown> {
  if (!response.body) {
    throw new SeoDataClientError("UNAVAILABLE", true);
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
        throw new SeoDataClientError("UNAVAILABLE", true);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SeoDataClientError) throw error;
    throw new SeoDataClientError("UNAVAILABLE", true);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SeoDataClientError("UNAVAILABLE", true);
  }
}
