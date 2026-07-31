import type {
  InternalNormalizedRankResult,
  RankManifestHash,
  TrackingDomainMatchRule
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  canonicalizeJson
} from "@seo-platform/contracts/canonical-json";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
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
const ARSENKIN_GET_URL = new URL(
  "https://arsenkin.ru/api/tools/get"
);
const TASK_ID_PATTERN = /^[a-z0-9_-]{1,100}$/iu;
const REGION_ID_PATTERN = /^[1-9]\d{0,9}$/u;
const STAGED_RESULT_SCHEMA = "arsenkin-rank-result@1" as const;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface ArsenkinRankWireRequest {
  readonly tools_name: "check-top";
  readonly data: {
    readonly queries: readonly string[];
    readonly is_snippet: false;
    readonly noreask: false;
    readonly se: readonly [
      {
        readonly type: 11 | 12;
        readonly region: number;
      }
    ];
    readonly depth: 30;
  };
}

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
 * The public operation remains POSITIONS, while the wire implementation uses
 * the documented check-top matrix and derives the first matching project URL
 * locally. Raw provider responses are never returned from normalization and
 * must not be logged or persisted by callers.
 */
export class ArsenkinRankConnector {
  public constructor(private readonly fetcher: ProviderFetch = fetch) {}

  public async submit(
    intentValue: unknown,
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<ArsenkinRankSubmitResult> {
    const request = buildArsenkinRankWireRequest(intentValue);
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
    try {
      const response = await providerJsonRequest(
        ARSENKIN_GET_URL,
        requestInit(secret, { task_id: taskId }),
        timeoutMs,
        this.fetcher
      );
      return fetchResult(
        response.status,
        response.value,
        taskId,
        response.retryAfterSeconds
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

export function buildArsenkinRankWireRequest(
  intentValue: unknown
): ArsenkinRankWireRequest {
  const intent = rankProviderRequestIntent(intentValue);
  const region = arsenkinRegion(intent.execution.regionCode);
  return {
    tools_name: "check-top",
    data: {
      queries: intent.keywords.map((keyword) => keyword.keywordText),
      is_snippet: false,
      noreask: false,
      se: [
        {
          type: intent.execution.device === "MOBILE" ? 12 : 11,
          region
        }
      ],
      depth: 30
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

  const outerResult = record(body.result);
  const request = record(outerResult.request);
  const providerResult = record(outerResult.result);
  verifyRequestEcho(request, intent);

  const collect = array(providerResult.collect);
  if (collect.length !== 1) invalidResponse();
  const queryResults = array(collect[0]);
  if (queryResults.length !== intent.keywords.length) invalidResponse();

  return queryResults.map((rawUrls, index) => {
    const urls = array(rawUrls);
    if (urls.length > intent.execution.depth) invalidResponse();
    const parsedUrls = urls.map(providerUrl);
    const matchIndex = parsedUrls.findIndex(({ url }) =>
      matchesProject(
        url,
        intent.project.domain,
        intent.execution.domainMatchRule
      )
    );
    const keyword = intent.keywords[index];
    if (!keyword) invalidResponse();
    if (matchIndex < 0) {
      return {
        manifestEntryId: keyword.manifestEntryId,
        keywordId: keyword.keywordId,
        found: false,
        position: null,
        dataQualityFlags: []
      };
    }
    const match = parsedUrls[matchIndex];
    if (!match) invalidResponse();
    return {
      manifestEntryId: keyword.manifestEntryId,
      keywordId: keyword.keywordId,
      found: true,
      position: matchIndex + 1,
      rankingUrl: match.original,
      normalizedRankingUrl: match.normalized,
      resultType: "ORGANIC",
      serpFeatures: [],
      dataQualityFlags: [
        "ABSOLUTE_POSITION_UNAVAILABLE",
        "PIXEL_POSITION_UNAVAILABLE",
        "TITLE_UNAVAILABLE",
        "SNIPPET_UNAVAILABLE"
      ]
    };
  });
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
    input.results.length > 250 ||
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
    value: canonicalJsonSha256("arsenkin-rank-request@1", request)
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
  if (typeof body.code === "string" || typeof body.status === "string") {
    return { status: "PENDING" };
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
  if (
    input.tools_name !== "check-top" ||
    Object.keys(input).length !== 2 ||
    Object.keys(data).length !== 5 ||
    queries.length < 1 ||
    queries.length > 250 ||
    queries.some(
      (query) =>
        typeof query !== "string" ||
        query.length < 1 ||
        query.length > 2_048
    ) ||
    data.is_snippet !== false ||
    data.noreask !== false ||
    data.depth !== 30 ||
    engines.length !== 1
  ) {
    throw new TypeError("Invalid Arsenkin rank wire request");
  }
  const engine = record(engines[0]);
  if (
    Object.keys(engine).length !== 2 ||
    ![11, 12].includes(Number(engine.type)) ||
    !Number.isSafeInteger(engine.region) ||
    Number(engine.region) <= 0
  ) {
    throw new TypeError("Invalid Arsenkin rank wire request");
  }
  return {
    tools_name: "check-top",
    data: {
      queries: queries as readonly string[],
      is_snippet: false,
      noreask: false,
      se: [
        {
          type: engine.type as 11 | 12,
          region: Number(engine.region)
        }
      ],
      depth: 30
    }
  };
}

function verifyRequestEcho(
  request: Readonly<Record<string, unknown>>,
  intent: RankProviderRequestIntentV1
): void {
  const queries = array(request.queries);
  if (
    queries.length !== intent.keywords.length ||
    queries.some(
      (query, index) => query !== intent.keywords[index]?.keywordText
    ) ||
    request.depth !== 30
  ) {
    invalidResponse();
  }
  const engines = array(request.ss);
  if (engines.length !== 1) invalidResponse();
  const engine = record(engines[0]);
  const expectedType = intent.execution.device === "MOBILE" ? 12 : 11;
  if (
    engine.ss !== expectedType ||
    engine.region !== arsenkinRegion(intent.execution.regionCode)
  ) {
    invalidResponse();
  }
}

function matchesProject(
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

function providerUrl(value: unknown): {
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
    throw new TypeError("Arsenkin requires a numeric Google region id");
  }
  const region = Number(value);
  if (!Number.isSafeInteger(region)) {
    throw new TypeError("Arsenkin requires a numeric Google region id");
  }
  return region;
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
