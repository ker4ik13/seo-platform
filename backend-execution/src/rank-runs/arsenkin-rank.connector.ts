import {
  rankProviderKeywordLimit,
  rankExecutionPurpose,
  rankExecutionTracksProjectPosition,
  type InternalNormalizedRankResult,
  type InternalNormalizedRankSerpResult,
  type RankManifestHash,
  type TrackingDomainMatchRule
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  canonicalizeJson
} from "@seo-platform/contracts/canonical-json";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import type { ArsenkinHttpRateLimitGate } from "../integrations/arsenkin-http-rate-limiter.js";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import {
  providerJsonRequest,
  ProviderTransportError
} from "../integrations/provider-json-request.js";
import {
  rankProviderRequestIntent,
  type RankProviderRequestIntentV1
} from "./rank-provider-request-intent.js";

const ARSENKIN_SET_URL = new URL(
  "https://arsenkin.ru/api/tools/set"
);
const ARSENKIN_CHECK_URL = new URL(
  "https://arsenkin.ru/api/tools/check"
);
const ARSENKIN_GET_URL = new URL(
  "https://arsenkin.ru/api/tools/get"
);
const TASK_ID_PATTERN = /^[a-z0-9_-]{1,100}$/iu;
const REGION_ID_PATTERN = /^[1-9]\d{0,9}$/u;
const STAGED_RESULT_SCHEMA = "arsenkin-rank-result@1" as const;
const ARSENKIN_RANK_RESULT_MAX_BYTES = 128 * 1_048_576;
const MAX_SERP_TITLE_LENGTH = 2_048;
const MAX_SERP_SNIPPET_LENGTH = 8_192;
const MAX_SERP_FAVICON_URL_LENGTH = 4_096;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface ArsenkinPositionWireRequest {
  readonly tools_name: "positions";
  readonly data: {
    readonly queries: readonly string[];
    readonly url: string;
    readonly alt_urls: readonly string[];
    readonly subdomain: boolean;
    readonly se: readonly [
      | {
          readonly type: 1 | 2 | 3;
          readonly region: number;
        }
      | {
          readonly type: 11 | 12;
          readonly region: number;
          readonly depth: 30 | 50 | 100;
        }
    ];
    readonly format: 0 | 1;
  };
}

export interface ArsenkinCheckTopWireRequest {
  readonly tools_name: "check-top";
  readonly data: {
    readonly queries: readonly string[];
    readonly is_snippet: true;
    readonly noreask: false;
    readonly se: readonly [{
      readonly type: 1 | 2 | 3 | 11 | 12;
      readonly region: number;
    }];
    readonly depth: 10;
  };
}

export type ArsenkinRankWireRequest =
  | ArsenkinPositionWireRequest
  | ArsenkinCheckTopWireRequest;

export type ArsenkinRankSubmitResult =
  | {
      readonly status: "ACCEPTED";
      readonly taskId: string;
      readonly request: ArsenkinRankWireRequest;
    }
  | {
      readonly status: "RETRYABLE_FAILURE";
      readonly code: "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE";
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly status: "REJECTED";
      readonly code:
        | "INVALID_CREDENTIAL"
        | "PROVIDER_PLAN_OR_REQUEST_REJECTED"
        | "INVALID_PROVIDER_RESPONSE";
    }
  | {
      readonly status: "OUTCOME_UNKNOWN";
      readonly code: "PROVIDER_TRANSPORT_AMBIGUOUS";
    };

export type ArsenkinRankFetchResult =
  | {
      readonly status: "READY";
      readonly value: unknown;
    }
  | {
      readonly status: "PENDING";
    }
  | {
      readonly status: "RETRYABLE_FAILURE";
      readonly code: "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE";
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly status: "REJECTED";
      readonly code:
        | "INVALID_CREDENTIAL"
        | "PROVIDER_PLAN_OR_REQUEST_REJECTED"
        | "INVALID_PROVIDER_RESPONSE";
    };

type ArsenkinRankCheckResult =
  | { readonly status: "READY" }
  | Exclude<ArsenkinRankFetchResult, { readonly status: "READY" }>;

export interface ArsenkinStagedRankResultV1 {
  readonly schemaVersion: "arsenkin-rank-result@1";
  readonly providerRequestId: string;
  readonly connectorVersion: string;
  readonly observedAt: string;
  readonly results: readonly InternalNormalizedRankResult[];
}

export interface ArsenkinStagedRankResult {
  readonly snapshot: ArsenkinStagedRankResultV1;
  readonly hash: RankManifestHash;
}

/**
 * BYOK Arsenkin adapter for rank checks.
 *
 * Uses Arsenkin's documented `positions` tool, which receives the project URL
 * and returns the site's measured position and relevant URL. Raw provider
 * responses are never returned from normalization and must not be logged or
 * persisted by callers.
 */
export class ArsenkinRankConnector {
  public constructor(
    private readonly rateLimiter: ArsenkinHttpRateLimitGate,
    private readonly fetcher: ProviderFetch = fetch
  ) {}

  public async submit(
    intentValue: unknown,
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<ArsenkinRankSubmitResult> {
    const request = buildArsenkinRankWireRequest(intentValue);
    const permit = await this.rateLimiter.tryAcquire(
      secret.rateLimitScopeId
    );
    if (!permit.allowed) {
      return rateLimited(permit.retryAfterSeconds);
    }
    try {
      const response = await providerJsonRequest(
        ARSENKIN_SET_URL,
        requestInit(secret, request),
        timeoutMs,
        this.fetcher
      );
      return submitResult(response.status, response.value, request, response.retryAfterSeconds);
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return {
          status: "OUTCOME_UNKNOWN",
          code: "PROVIDER_TRANSPORT_AMBIGUOUS"
        };
      }
      throw error;
    }
  }

  public async fetchResult(
    taskIdValue: string,
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<ArsenkinRankFetchResult> {
    const taskId = taskIdValueOf(taskIdValue);
    const checkPermit = await this.rateLimiter.tryAcquire(
      secret.rateLimitScopeId
    );
    if (!checkPermit.allowed) {
      return rateLimited(checkPermit.retryAfterSeconds);
    }
    try {
      const checkResponse = await providerJsonRequest(
        ARSENKIN_CHECK_URL,
        requestInit(secret, { task_id: taskId }),
        timeoutMs,
        this.fetcher
      );
      const checked = checkResult(
        checkResponse.status,
        checkResponse.value,
        checkResponse.retryAfterSeconds
      );
      if (checked.status !== "READY") return checked;

      const getPermit = await this.rateLimiter.tryAcquire(
        secret.rateLimitScopeId
      );
      if (!getPermit.allowed) {
        return rateLimited(getPermit.retryAfterSeconds);
      }
      const resultResponse = await providerJsonRequest(
        ARSENKIN_GET_URL,
        requestInit(secret, { task_id: taskId }),
        timeoutMs,
        this.fetcher,
        Date.now,
        ARSENKIN_RANK_RESULT_MAX_BYTES
      );
      return fetchResult(
        resultResponse.status,
        resultResponse.value,
        taskId,
        resultResponse.retryAfterSeconds
      );
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return {
          status: "RETRYABLE_FAILURE",
          code: "PROVIDER_UNAVAILABLE"
        };
      }
      throw error;
    }
  }
}

function rateLimited(retryAfterSeconds: number): {
  readonly status: "RETRYABLE_FAILURE";
  readonly code: "PROVIDER_RATE_LIMITED";
  readonly retryAfterSeconds: number;
} {
  return {
    status: "RETRYABLE_FAILURE",
    code: "PROVIDER_RATE_LIMITED",
    retryAfterSeconds
  };
}

export function buildArsenkinRankWireRequest(
  intentValue: unknown
): ArsenkinRankWireRequest {
  const intent = rankProviderRequestIntent(intentValue);
  const region = arsenkinRegion(intent.execution.regionCode);
  const tracking = arsenkinTrackingUrls(intent);
  const searchType = arsenkinSearchType(
    intent.execution.searchEngine,
    intent.execution.device,
    intent.execution.providerMappingVersion
  );
  if (rankExecutionPurpose(intent.execution) === "COMPETITOR_SERP") {
    return {
      tools_name: "check-top",
      data: {
        queries: intent.keywords.map((keyword) => keyword.keywordText),
        is_snippet: true,
        noreask: false,
        se: [{ type: searchType, region }],
        depth: 10
      }
    };
  }
  return {
    tools_name: "positions",
    data: {
      queries: intent.keywords.map((keyword) => keyword.keywordText),
      url: tracking.url,
      alt_urls: tracking.altUrls,
      subdomain: tracking.includeSubdomains,
      se: [
        searchType === 11 || searchType === 12
          ? { type: searchType, region, depth: intent.execution.depth }
          : { type: searchType, region }
      ],
      format: 0
    }
  };
}

export function normalizeArsenkinRankResult(
  value: unknown,
  taskIdValue: string,
  intentValue: unknown
): readonly InternalNormalizedRankResult[] {
  const taskId = taskIdValueOf(taskIdValue);
  const intent = rankProviderRequestIntent(intentValue);
  const body = record(value);
  if (
    body.code !== "TASK_RESULT" ||
    taskIdFromUnknown(body.task_id) !== taskId
  ) {
    invalidResponse();
  }
  if (rankExecutionPurpose(intent.execution) === "COMPETITOR_SERP") {
    return normalizeArsenkinCheckTopResult(body.result, intent);
  }
  if (
    typeof body.created_at !== "string" ||
    typeof body.finished_at !== "string"
  ) {
    invalidResponse();
  }

  const providerResult = record(body.result);
  if (providerResult.format !== 0) invalidResponse();
  record(providerResult.summary);
  const table = record(providerResult.table);
  const queryTexts = new Set(
    intent.keywords.map((keyword) => keyword.keywordText)
  );
  const tableKeys = Object.keys(table);
  if (
    tableKeys.length !== queryTexts.size ||
    tableKeys.some((query) => !queryTexts.has(query))
  ) {
    invalidResponse();
  }

  return intent.keywords.map((keyword) =>
    normalizeArsenkinPositionRow(
      table[keyword.keywordText],
      keyword,
      intent
    )
  );
}

export function stageArsenkinRankResult(
  value: unknown,
  taskIdValue: string,
  intentValue: unknown,
  observedAtValue: string
): ArsenkinStagedRankResult {
  const taskId = taskIdValueOf(taskIdValue);
  const intent = rankProviderRequestIntent(intentValue);
  const observedAt = timestamp(observedAtValue);
  const snapshot: ArsenkinStagedRankResultV1 = {
    schemaVersion: STAGED_RESULT_SCHEMA,
    providerRequestId: taskId,
    connectorVersion: intent.executionConnectorVersion,
    observedAt,
    results: normalizeArsenkinRankResult(value, taskId, intent)
  };
  canonicalizeJson(snapshot);
  return {
    snapshot,
    hash: {
      algorithm: "SHA_256",
      value: canonicalJsonSha256(STAGED_RESULT_SCHEMA, snapshot)
    }
  };
}

export function arsenkinStagedRankResult(
  value: unknown
): ArsenkinStagedRankResultV1 {
  const input = record(value);
  if (
    Object.keys(input).length !== 5 ||
    input.schemaVersion !== STAGED_RESULT_SCHEMA ||
    typeof input.providerRequestId !== "string" ||
    typeof input.connectorVersion !== "string" ||
    typeof input.observedAt !== "string" ||
    !Array.isArray(input.results) ||
    input.results.length < 1 ||
    input.results.length > rankProviderKeywordLimit ||
    !/^[a-z0-9][a-z0-9@._-]{0,63}$/u.test(input.connectorVersion)
  ) {
    throw new TypeError("Invalid staged Arsenkin rank result");
  }
  const snapshot: ArsenkinStagedRankResultV1 = {
    schemaVersion: STAGED_RESULT_SCHEMA,
    providerRequestId: taskIdValueOf(input.providerRequestId),
    connectorVersion: input.connectorVersion,
    observedAt: timestamp(input.observedAt),
    results:
      input.results as unknown as readonly InternalNormalizedRankResult[]
  };
  canonicalizeJson(snapshot);
  return snapshot;
}

export function arsenkinStagedRankResultHash(
  value: unknown
): RankManifestHash {
  const snapshot = arsenkinStagedRankResult(value);
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(STAGED_RESULT_SCHEMA, snapshot)
  };
}

export function arsenkinRankWireRequestHash(
  value: unknown
): RankManifestHash {
  const request = wireRequest(value);
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(
      request.tools_name === "check-top"
        ? "arsenkin-check-top-request@1"
        : "arsenkin-rank-request@2",
      request
    )
  };
}

function submitResult(
  status: number,
  value: unknown,
  request: ArsenkinRankWireRequest,
  retryAfterSeconds: number | undefined
): ArsenkinRankSubmitResult {
  const failure = httpFailure(status, value, retryAfterSeconds);
  if (failure) return failure;
  const body = record(value);
  const taskId = taskIdFromUnknown(body.task_id);
  if (!taskId) {
    return { status: "REJECTED", code: "INVALID_PROVIDER_RESPONSE" };
  }
  return { status: "ACCEPTED", taskId, request };
}

function checkResult(
  status: number,
  value: unknown,
  retryAfterSeconds: number | undefined
): ArsenkinRankCheckResult {
  const failure = httpFailure(status, value, retryAfterSeconds);
  if (failure) return failure;
  const body = record(value);
  const progress = taskProgress(body.progress);
  if (
    body.code !== "TASK_STATUS" ||
    progress === undefined
  ) {
    return { status: "REJECTED", code: "INVALID_PROVIDER_RESPONSE" };
  }
  if (body.status === "process" && progress < 100) {
    return { status: "PENDING" };
  }
  if (body.status === "finish" && progress === 100) {
    return { status: "READY" };
  }
  return { status: "REJECTED", code: "INVALID_PROVIDER_RESPONSE" };
}

function taskProgress(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 100
      ? value
      : undefined;
  }
  if (typeof value !== "string" || !/^\d{1,3}%?$/u.test(value)) {
    return undefined;
  }
  const progress = Number(value.replace(/%$/u, ""));
  return progress >= 0 && progress <= 100 ? progress : undefined;
}

function fetchResult(
  status: number,
  value: unknown,
  taskId: string,
  retryAfterSeconds: number | undefined
): ArsenkinRankFetchResult {
  const failure = httpFailure(status, value, retryAfterSeconds);
  if (failure) return failure;
  const body = record(value);
  const responseTaskId = taskIdFromUnknown(body.task_id);
  if (responseTaskId !== taskId) {
    return { status: "REJECTED", code: "INVALID_PROVIDER_RESPONSE" };
  }
  if (body.code === "TASK_RESULT") {
    return { status: "READY", value };
  }
  return { status: "REJECTED", code: "INVALID_PROVIDER_RESPONSE" };
}

function httpFailure(
  status: number,
  value: unknown,
  retryAfterSeconds: number | undefined
):
  | Exclude<
      ArsenkinRankSubmitResult,
      { readonly status: "ACCEPTED" | "OUTCOME_UNKNOWN" }
    >
  | undefined {
  const body = optionalRecord(value);
  const providerCode =
    typeof body?.code === "number" || typeof body?.code === "string"
      ? String(body.code)
      : undefined;
  const providerError =
    body?.status === "Error" || body?.status === "error" || body?.error;
  if (status === 401 || status === 403 || providerCode === "401" || providerCode === "403") {
    return { status: "REJECTED", code: "INVALID_CREDENTIAL" };
  }
  if (status === 429 || providerCode === "429") {
    return {
      status: "RETRYABLE_FAILURE",
      code: "PROVIDER_RATE_LIMITED",
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
    };
  }
  if (status >= 500) {
    return {
      status: "RETRYABLE_FAILURE",
      code: "PROVIDER_UNAVAILABLE",
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
    };
  }
  if (status < 200 || status >= 300 || providerError) {
    return {
      status: "REJECTED",
      code: "PROVIDER_PLAN_OR_REQUEST_REJECTED"
    };
  }
  return undefined;
}

function requestInit(
  secret: IntegrationCredentialSecret,
  body: unknown
): RequestInit {
  return {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${secret.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

function wireRequest(value: unknown): ArsenkinRankWireRequest {
  const input = record(value);
  const data = record(input.data);
  const queries = array(data.queries);
  const engines = array(data.se);
  if (input.tools_name === "check-top") {
    if (
      Object.keys(input).length !== 2 ||
      !hasExactKeys(data, [
        "depth",
        "is_snippet",
        "noreask",
        "queries",
        "se"
      ]) ||
      queries.length < 1 ||
      queries.length > rankProviderKeywordLimit ||
      queries.some(
        (query) =>
          typeof query !== "string" ||
          query.length < 1 ||
          query.length > 2_048
      ) ||
      data.depth !== 10 ||
      data.is_snippet !== true ||
      data.noreask !== false ||
      engines.length !== 1
    ) {
      throw new TypeError("Invalid Arsenkin check-top wire request");
    }
    const engine = record(engines[0]);
    if (
      !hasExactKeys(engine, ["region", "type"]) ||
      ![1, 2, 3, 11, 12].includes(Number(engine.type)) ||
      !Number.isSafeInteger(engine.region) ||
      Number(engine.region) <= 0
    ) {
      throw new TypeError("Invalid Arsenkin check-top wire request");
    }
    return {
      tools_name: "check-top",
      data: {
        queries: queries as readonly string[],
        is_snippet: true,
        noreask: false,
        se: [{
          type: Number(engine.type) as 1 | 2 | 3 | 11 | 12,
          region: Number(engine.region)
        }],
        depth: 10
      }
    };
  }
  if (
    input.tools_name !== "positions" ||
    Object.keys(input).length !== 2 ||
    Object.keys(data).length !== 6 ||
    queries.length < 1 ||
    queries.length > rankProviderKeywordLimit ||
    queries.some(
      (query) =>
        typeof query !== "string" ||
        query.length < 1 ||
        query.length > 2_048
    ) ||
    typeof data.url !== "string" ||
    typeof data.subdomain !== "boolean" ||
    !Array.isArray(data.alt_urls) ||
    ![0, 1].includes(Number(data.format)) ||
    engines.length !== 1
  ) {
    throw new TypeError("Invalid Arsenkin rank wire request");
  }
  const engine = record(engines[0]);
  const type = Number(engine.type);
  const isGoogle = type === 11 || type === 12;
  if (
    Object.keys(engine).length !== (isGoogle ? 3 : 2) ||
    ![1, 2, 3, 11, 12].includes(Number(engine.type)) ||
    !Number.isSafeInteger(engine.region) ||
    Number(engine.region) <= 0 ||
    (isGoogle && ![30, 50, 100].includes(Number(engine.depth))) ||
    (!isGoogle && engine.depth !== undefined)
  ) {
    throw new TypeError("Invalid Arsenkin rank wire request");
  }
  return {
    tools_name: "positions",
    data: {
      queries: queries as readonly string[],
      url: providerUrl(data.url).normalized,
      alt_urls: (data.alt_urls as readonly unknown[]).map(
        (url) => providerUrl(url).normalized
      ),
      subdomain: data.subdomain,
      se: [
        isGoogle
          ? {
              type: type as 11 | 12,
              region: Number(engine.region),
              depth: Number(engine.depth) as 30 | 50 | 100
            }
          : {
              type: type as 1 | 2 | 3,
              region: Number(engine.region)
            }
      ],
      format: Number(data.format) as 0 | 1
    }
  };
}

function normalizeArsenkinPositionRow(
  value: unknown,
  keyword: RankProviderRequestIntentV1["keywords"][number],
  intent: RankProviderRequestIntentV1
): InternalNormalizedRankResult {
  const row = record(value);
  const positions = array(row.position);
  const topResults = parseArsenkinTop20(row.top20);
  if (
    positions.length !== 1 ||
    !Number.isSafeInteger(positions[0])
  ) {
    invalidResponse();
  }
  const position = Number(positions[0]);
  if (position === 1_001) {
    if (!hasExactKeys(row, ["position", "top20"])) invalidResponse();
    return {
      manifestEntryId: keyword.manifestEntryId,
      keywordId: keyword.keywordId,
      found: false,
      position: null,
      ...(topResults.length === 0 ? {} : { serpResults: topResults }),
      dataQualityFlags: []
    };
  }
  if (
    position < 1 ||
    position > intent.execution.depth ||
    !hasExactKeys(row, ["commerce", "position", "top20", "url"])
  ) {
    invalidResponse();
  }
  const commerce = array(row.commerce);
  if (commerce.length !== 1 || typeof commerce[0] !== "boolean") {
    invalidResponse();
  }
  const rankingUrl = providerUrl(row.url);
  if (
    !matchesProject(
      rankingUrl.url,
      intent.project.domain,
      intent.execution.domainMatchRule
    )
  ) {
    invalidResponse();
  }
  const serpResults = withPrimaryArsenkinResult(
    topResults,
    position,
    rankingUrl
  );
  const primarySerpResult = serpResults.find(
    (result) => result.position === position
  );
  return {
    manifestEntryId: keyword.manifestEntryId,
    keywordId: keyword.keywordId,
    found: true,
    position,
    rankingUrl: rankingUrl.original,
    normalizedRankingUrl: rankingUrl.normalized,
    ...(primarySerpResult?.title === undefined
      ? {}
      : { title: primarySerpResult.title }),
    ...(primarySerpResult?.snippet === undefined
      ? {}
      : { snippet: primarySerpResult.snippet }),
    resultType: "ORGANIC",
    serpFeatures: [],
    serpResults,
    dataQualityFlags: [
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE",
      ...(primarySerpResult?.title === undefined
        ? ["TITLE_UNAVAILABLE"] as const
        : []),
      ...(primarySerpResult?.snippet === undefined
        ? ["SNIPPET_UNAVAILABLE"] as const
        : [])
    ]
  };
}

function normalizeArsenkinCheckTopResult(
  value: unknown,
  intent: RankProviderRequestIntentV1
): readonly InternalNormalizedRankResult[] {
  const providerResult = record(value);
  const result = record(providerResult.result);
  const collect = array(result.collect);
  if (collect.length !== 1) invalidResponse();
  const rows = array(collect[0]);
  if (rows.length !== intent.keywords.length) invalidResponse();
  const snippets = optionalRecord(result.snippets) ?? {};
  const saveProjectPosition = rankExecutionTracksProjectPosition(
    intent.execution
  );
  return intent.keywords.map((keyword, queryIndex) => {
    const urls = array(rows[queryIndex]);
    if (urls.length > 10) invalidResponse();
    const serpResults = urls.map((rawUrl, index) => {
      const rankingUrl = providerUrl(rawUrl);
      const snippet = arsenkinCheckTopSnippet(
        snippets[rankingUrl.original]
      );
      return {
        position: index + 1,
        rankingUrl: rankingUrl.original,
        normalizedRankingUrl: rankingUrl.normalized,
        ...(snippet?.title === undefined ? {} : { title: snippet.title }),
        ...(snippet?.snippet === undefined
          ? {}
          : { snippet: snippet.snippet })
      } satisfies InternalNormalizedRankSerpResult;
    });
    const projectResult = saveProjectPosition
      ? serpResults.find((entry) => {
          try {
            return matchesProject(
              new URL(entry.rankingUrl),
              intent.project.domain,
              intent.execution.domainMatchRule
            );
          } catch {
            return false;
          }
        })
      : undefined;
    if (!projectResult) {
      return {
        manifestEntryId: keyword.manifestEntryId,
        keywordId: keyword.keywordId,
        found: false,
        position: null,
        serpResults,
        dataQualityFlags: []
      } satisfies InternalNormalizedRankResult;
    }
    return {
      manifestEntryId: keyword.manifestEntryId,
      keywordId: keyword.keywordId,
      found: true,
      position: projectResult.position,
      rankingUrl: projectResult.rankingUrl,
      normalizedRankingUrl: projectResult.normalizedRankingUrl,
      ...(projectResult.title === undefined
        ? {}
        : { title: projectResult.title }),
      ...(projectResult.snippet === undefined
        ? {}
        : { snippet: projectResult.snippet }),
      resultType: "ORGANIC",
      serpFeatures: [],
      serpResults,
      dataQualityFlags: [
        "ABSOLUTE_POSITION_UNAVAILABLE",
        "PIXEL_POSITION_UNAVAILABLE",
        ...(projectResult.title === undefined
          ? ["TITLE_UNAVAILABLE"] as const
          : []),
        ...(projectResult.snippet === undefined
          ? ["SNIPPET_UNAVAILABLE"] as const
          : [])
      ]
    } satisfies InternalNormalizedRankResult;
  });
}

function arsenkinCheckTopSnippet(value: unknown):
  | { readonly title?: string; readonly snippet?: string }
  | undefined {
  const indexed = optionalRecord(value);
  const candidates = Array.isArray(value)
    ? value
    : indexed
      ? Object.entries(indexed)
          .filter(([key]) => /^\d+$/u.test(key))
          .sort(([left], [right]) => Number(left) - Number(right))
          .map(([, candidate]) => candidate)
      : [];
  for (const candidate of candidates) {
    const input = optionalRecord(candidate);
    if (!input) continue;
    const title = boundedProviderText(input.title, MAX_SERP_TITLE_LENGTH);
    const snippet = boundedProviderText(
      input.snippet,
      MAX_SERP_SNIPPET_LENGTH
    );
    if (title !== undefined || snippet !== undefined) {
      return {
        ...(title === undefined ? {} : { title }),
        ...(snippet === undefined ? {} : { snippet })
      };
    }
  }
  return undefined;
}

function parseArsenkinTop20(
  value: unknown
): readonly InternalNormalizedRankSerpResult[] {
  if (typeof value !== "string" || value.length > 1_000_000) {
    invalidResponse();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalidResponse();
  }
  const result = array(parsed);
  if (result.length > 20) invalidResponse();
  const rows = result.flatMap((entry, index) => {
    const projected = arsenkinTopResult(entry, index + 1);
    return projected ? [projected] : [];
  }).sort((left, right) => left.position - right.position);
  const positions = new Set<number>();
  return rows.filter(({ position }) => {
    if (positions.has(position)) return false;
    positions.add(position);
    return true;
  });
}

function arsenkinTopResult(
  value: unknown,
  fallbackPosition: number
): InternalNormalizedRankSerpResult | undefined {
  let rawUrl: unknown;
  let rawPosition: unknown;
  let rawTitle: unknown;
  let rawSnippet: unknown;
  let rawFaviconUrl: unknown;
  if (typeof value === "string") {
    rawUrl = value;
  } else if (Array.isArray(value)) {
    [rawUrl, rawTitle, rawSnippet, rawFaviconUrl] = value;
  } else {
    const input = optionalRecord(value);
    if (!input) return undefined;
    rawUrl = input.url ?? input.href ?? input.link;
    rawPosition = input.position;
    rawTitle = input.title;
    rawSnippet = input.snippet ?? input.description;
    rawFaviconUrl =
      input.faviconUrl ??
      input.favicon_url ??
      input.favicon ??
      input.iconUrl ??
      input.icon_url ??
      input.icon;
  }
  const position = Number.isSafeInteger(rawPosition)
    ? Number(rawPosition)
    : fallbackPosition;
  if (position < 1 || position > 100) return undefined;
  let rankingUrl: ReturnType<typeof providerUrl>;
  try {
    rankingUrl = providerUrl(rawUrl);
  } catch {
    return undefined;
  }
  const title = boundedProviderText(rawTitle, MAX_SERP_TITLE_LENGTH);
  const snippet = boundedProviderText(rawSnippet, MAX_SERP_SNIPPET_LENGTH);
  const faviconUrl = providerSerpFaviconUrl(rawFaviconUrl);
  return {
    position,
    rankingUrl: rankingUrl.original,
    normalizedRankingUrl: rankingUrl.normalized,
    ...(faviconUrl === undefined ? {} : { faviconUrl }),
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet })
  };
}

function withPrimaryArsenkinResult(
  values: readonly InternalNormalizedRankSerpResult[],
  position: number,
  rankingUrl: ReturnType<typeof providerUrl>
): readonly InternalNormalizedRankSerpResult[] {
  const byPosition = new Map(values.map((result) => [result.position, result]));
  const captured = [...byPosition.values()].find(
    (result) => result.normalizedRankingUrl === rankingUrl.normalized
  );
  if (captured && captured.position !== position) {
    byPosition.delete(captured.position);
  }
  byPosition.set(position, {
    position,
    rankingUrl: rankingUrl.original,
    normalizedRankingUrl: rankingUrl.normalized,
    ...(captured?.faviconUrl === undefined
      ? {}
      : { faviconUrl: captured.faviconUrl }),
    ...(captured?.title === undefined ? {} : { title: captured.title }),
    ...(captured?.snippet === undefined ? {} : { snippet: captured.snippet })
  });
  return [...byPosition.values()].sort(
    (left, right) => left.position - right.position
  );
}

export function providerSerpFaviconUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const source = value.trim();
  if (source.length < 1 || source.length > MAX_SERP_FAVICON_URL_LENGTH) {
    return undefined;
  }
  const absolute = source.startsWith("//") ? `https:${source}` : source;
  try {
    const url = new URL(absolute);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function boundedProviderText(
  value: unknown,
  maxLength: number
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function arsenkinTrackingUrls(intent: RankProviderRequestIntentV1): {
  readonly url: string;
  readonly altUrls: readonly string[];
  readonly includeSubdomains: boolean;
} {
  const rule = intent.execution.domainMatchRule;
  if (rule.mode === "ANY_PROJECT_MIRROR") {
    throw new TypeError(
      "Arsenkin positions requires a sealed project mirror snapshot"
    );
  }
  if (rule.mode === "SPECIFIC_URL" || rule.mode === "URL_PREFIX") {
    return {
      url: providerUrl(rule.value).normalized,
      altUrls: [],
      includeSubdomains: false
    };
  }
  const canonicalHost = intent.project.domain.toLowerCase();
  const canonicalUrl = providerUrl(`https://${canonicalHost}/`).normalized;
  if (rule.mode !== "INCLUDE_WWW") {
    return {
      url: canonicalUrl,
      altUrls: [],
      includeSubdomains: rule.mode === "INCLUDE_SUBDOMAINS"
    };
  }
  const baseHost = withoutWww(canonicalHost);
  const alternateHost = canonicalHost.startsWith("www.")
    ? baseHost
    : `www.${baseHost}`;
  return {
    url: canonicalUrl,
    altUrls: [providerUrl(`https://${alternateHost}/`).normalized],
    includeSubdomains: false
  };
}

export function matchesProject(
  url: URL,
  projectDomain: string,
  rule: TrackingDomainMatchRule
): boolean {
  const hostname = url.hostname.toLowerCase();
  const canonicalProject = projectDomain.toLowerCase();
  switch (rule.mode) {
    case "EXACT_HOST":
    case "CANONICAL_DOMAIN":
      return hostname === canonicalProject;
    case "INCLUDE_WWW": {
      const base = withoutWww(canonicalProject);
      return hostname === base || hostname === `www.${base}`;
    }
    case "INCLUDE_SUBDOMAINS": {
      const base = withoutWww(canonicalProject);
      return hostname === base || hostname.endsWith(`.${base}`);
    }
    case "SPECIFIC_URL":
      return normalizedUrl(url) === normalizedConfiguredUrl(rule.value);
    case "URL_PREFIX":
      return normalizedUrl(url).startsWith(normalizedConfiguredUrl(rule.value));
    case "ANY_PROJECT_MIRROR":
      throw new TypeError(
        "Arsenkin rank result requires a sealed project mirror snapshot"
      );
  }
}

export function providerUrl(value: unknown): {
  readonly original: string;
  readonly normalized: string;
  readonly url: URL;
} {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) {
    invalidResponse();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalidResponse();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    invalidResponse();
  }
  return {
    original: value,
    normalized: normalizedUrl(url),
    url
  };
}

function normalizedConfiguredUrl(value: string): string {
  return providerUrl(value).normalized;
}

function normalizedUrl(source: URL): string {
  const url = new URL(source);
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  return url.toString();
}

function arsenkinRegion(value: string | undefined): number {
  if (!value || !REGION_ID_PATTERN.test(value)) {
    throw new TypeError("Arsenkin requires a numeric search region id");
  }
  const region = Number(value);
  if (!Number.isSafeInteger(region)) {
    throw new TypeError("Arsenkin requires a numeric search region id");
  }
  return region;
}

function arsenkinSearchType(
  searchEngine: RankProviderRequestIntentV1["execution"]["searchEngine"],
  device: RankProviderRequestIntentV1["execution"]["device"],
  providerMappingVersion: string
): 1 | 2 | 3 | 11 | 12 {
  if (searchEngine === "YANDEX") {
    if (
      providerMappingVersion === "arsenkin-yandex-search-api@2" ||
      providerMappingVersion === "arsenkin-check-top-yandex-xml@1"
    ) {
      return 1;
    }
    return device === "MOBILE" ? 3 : 2;
  }
  return device === "MOBILE" ? 12 : 11;
}

function taskIdValueOf(value: string): string {
  if (!TASK_ID_PATTERN.test(value)) {
    throw new TypeError("Invalid Arsenkin task id");
  }
  return value;
}

function taskIdFromUnknown(value: unknown): string | undefined {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : typeof value === "string"
        ? value
        : undefined;
  return normalized && TASK_ID_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

function timestamp(value: string): string {
  if (
    !TIMESTAMP_PATTERN.test(value) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError("Invalid Arsenkin result observation timestamp");
  }
  return value;
}

function withoutWww(value: string): string {
  return value.startsWith("www.") ? value.slice(4) : value;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalidResponse();
  return value;
}

function optionalRecord(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  const result = optionalRecord(value);
  if (!result) invalidResponse();
  return result;
}

function invalidResponse(): never {
  throw new TypeError("Invalid Arsenkin rank provider response");
}
