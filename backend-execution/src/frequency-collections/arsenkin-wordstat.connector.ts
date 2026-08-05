import type {
  SemanticFrequencyDevice,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import { arsenkinWordstatKeywordLimit } from "@seo-platform/contracts";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import type { ArsenkinHttpRateLimitGate } from "../integrations/arsenkin-http-rate-limiter.js";
import {
  providerJsonRequest,
  ProviderTransportError
} from "../integrations/provider-json-request.js";

const ARSENKIN_SET_URL = new URL("https://arsenkin.ru/api/tools/set");
const ARSENKIN_CHECK_URL = new URL("https://arsenkin.ru/api/tools/check");
const ARSENKIN_GET_URL = new URL("https://arsenkin.ru/api/tools/get");
const TASK_ID_PATTERN = /^[a-z0-9_-]{1,100}$/iu;
const REGION_ID_PATTERN = /^(?:0|[1-9]\d{0,9})$/u;
const ARSENKIN_WORDSTAT_RESULT_MAX_BYTES = 32 * 1_048_576;

export type ArsenkinWordstatSubmitResult =
  | { readonly status: "ACCEPTED"; readonly taskId: string }
  | { readonly status: "RETRYABLE_FAILURE"; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly status: "REJECTED"; readonly code: string }
  | { readonly status: "OUTCOME_UNKNOWN"; readonly code: "PROVIDER_TRANSPORT_AMBIGUOUS" };

export type ArsenkinWordstatFetchResult =
  | {
      readonly status: "READY";
      readonly results: readonly ArsenkinWordstatQueryResult[];
    }
  | { readonly status: "PENDING"; readonly retryAfterSeconds: number }
  | { readonly status: "RETRYABLE_FAILURE"; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly status: "REJECTED"; readonly code: string };

export interface ArsenkinWordstatQueryResult {
  readonly query: string;
  readonly values: Readonly<Record<SemanticFrequencyType, string>>;
}

export class ArsenkinWordstatConnector {
  public readonly version = "arsenkin-wordstat@2.0.0";

  public constructor(
    private readonly rateLimiter: ArsenkinHttpRateLimitGate,
    private readonly fetcher: ProviderFetch = fetch
  ) {}

  public async submit(
    input: {
      readonly keywords: readonly string[];
      readonly types: readonly SemanticFrequencyType[];
      readonly regionCode: string;
      readonly device: SemanticFrequencyDevice;
    },
    secret: IntegrationCredentialSecret,
    timeoutMs: number,
    beforeRequest?: () => Promise<boolean>
  ): Promise<ArsenkinWordstatSubmitResult> {
    const request = arsenkinWordstatRequest(input);
    const permit = await this.rateLimiter.tryAcquire();
    if (!permit.allowed) return rateLimited(permit.retryAfterSeconds);
    if (beforeRequest && !(await beforeRequest())) {
      return {
        status: "RETRYABLE_FAILURE",
        code: "PROVIDER_CONCURRENCY_LIMITED",
        retryAfterSeconds: 5
      };
    }
    try {
      const response = await providerJsonRequest(
        ARSENKIN_SET_URL,
        requestInit(secret, request),
        timeoutMs,
        this.fetcher
      );
      const failure = providerFailure(
        response.status,
        response.value,
        response.retryAfterSeconds
      );
      if (failure) return failure;
      const taskId = taskIdFromUnknown(record(response.value)?.task_id);
      return taskId
        ? { status: "ACCEPTED", taskId }
        : { status: "REJECTED", code: "PROVIDER_INVALID_RESPONSE" };
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
    taskIdInput: string,
    keywords:
      | readonly string[]
      | (() => Promise<readonly string[]>),
    types: readonly SemanticFrequencyType[],
    regionCodeInput: string,
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<ArsenkinWordstatFetchResult> {
    const taskId = taskIdValue(taskIdInput);
    const regionCode = providerRegionCode(regionCodeInput);
    const checkPermit = await this.rateLimiter.tryAcquire();
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
      const checkFailure = providerFailure(
        checkResponse.status,
        checkResponse.value,
        checkResponse.retryAfterSeconds
      );
      if (checkFailure) return checkFailure;
      const taskStatus = arsenkinTaskStatus(checkResponse.value, taskId);
      if (taskStatus === "PENDING") {
        return { status: "PENDING", retryAfterSeconds: 5 };
      }
      if (taskStatus !== "FINISHED") {
        return { status: "REJECTED", code: "PROVIDER_INVALID_RESPONSE" };
      }

      const resolvedKeywords =
        typeof keywords === "function" ? await keywords() : keywords;

      const getPermit = await this.rateLimiter.tryAcquire();
      if (!getPermit.allowed) {
        return rateLimited(getPermit.retryAfterSeconds);
      }
      const resultResponse = await providerJsonRequest(
        ARSENKIN_GET_URL,
        requestInit(secret, { task_id: taskId }),
        timeoutMs,
        this.fetcher,
        Date.now,
        ARSENKIN_WORDSTAT_RESULT_MAX_BYTES
      );
      const failure = providerFailure(
        resultResponse.status,
        resultResponse.value,
        resultResponse.retryAfterSeconds
      );
      if (failure) return failure;
      const results = arsenkinWordstatBatchValues(
        resultResponse.value,
        taskId,
        resolvedKeywords,
        types,
        regionCode
      );
      return results
        ? { status: "READY", results }
        : { status: "REJECTED", code: "PROVIDER_INVALID_RESPONSE" };
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return { status: "RETRYABLE_FAILURE", code: "PROVIDER_UNAVAILABLE" };
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

export function arsenkinWordstatRequest(input: {
  readonly keywords: readonly string[];
  readonly types: readonly SemanticFrequencyType[];
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
}) {
  const keywords = normalizedQueries(input.keywords);
  if (input.types.length < 1) {
    throw new TypeError("Invalid Arsenkin Wordstat request");
  }
  const regionCode = providerRegionCode(input.regionCode);
  const types = [...new Set(input.types)];
  if (
    types.length !== input.types.length ||
    types.some((type) => type !== "BASE" && type !== "EXACT" && type !== "FIXED")
  ) {
    throw new TypeError("Invalid Arsenkin Wordstat frequency types");
  }
  return {
    tools_name: "wordstat" as const,
    data: {
      type: 1 as const,
      queries: keywords,
      device: arsenkinDevice(input.device),
      regions: [Number(regionCode)],
      ws: types.map(arsenkinType)
    }
  };
}

export function arsenkinWordstatBatchValues(
  value: unknown,
  taskIdInput: string,
  keywords: readonly string[],
  types: readonly SemanticFrequencyType[],
  regionCodeInput: string
): readonly ArsenkinWordstatQueryResult[] | undefined {
  const taskId = taskIdValue(taskIdInput);
  const regionCode = providerRegionCode(regionCodeInput);
  const body = record(value);
  if (
    body?.code !== "TASK_RESULT" ||
    taskIdFromUnknown(body.task_id) !== taskId ||
    !providerFinishedAt(body.finished_at)
  ) return undefined;
  const resultEnvelope = record(body.result);
  if (
    resultEnvelope?.type !== 1 ||
    taskIdFromUnknown(resultEnvelope.task_id) !== taskId
  ) return undefined;
  const data = record(resultEnvelope.data);
  if (taskIdFromUnknown(data?.task_id) !== taskId) return undefined;

  let queries: readonly string[];
  try {
    queries = normalizedQueries(keywords);
  } catch {
    return undefined;
  }
  if (!sameQueries(data?.queries, queries)) return undefined;
  const regions = record(data?.regions);
  if (typeof regions?.[regionCode] !== "string") return undefined;
  const providerResults = record(data?.result);
  if (!providerResults) return undefined;

  const requested = new Set(queries);
  const rows = new Map<string, Readonly<Record<string, unknown>>>();
  for (const [rawQuery, rawRegions] of Object.entries(providerResults)) {
    const query = normalizedQuery(rawQuery);
    if (!query || !requested.has(query) || rows.has(query)) return undefined;
    const regionRows = record(rawRegions);
    if (!regionRows || Object.keys(regionRows).length !== 1) return undefined;
    const row = record(regionRows[regionCode]);
    if (!row) return undefined;
    rows.set(query, row);
  }

  const output: ArsenkinWordstatQueryResult[] = [];
  for (const query of queries) {
    const row = rows.get(query);
    if (!row) return undefined;
    const values = valuesFromRecord(row, types);
    if (!values) return undefined;
    output.push({ query, values });
  }
  return output;
}

function arsenkinTaskStatus(
  value: unknown,
  taskId: string
): "PENDING" | "FINISHED" | undefined {
  const body = record(value);
  const progress = taskProgress(body?.progress);
  if (
    body?.code !== "TASK_STATUS" ||
    (body.task_id !== undefined && taskIdFromUnknown(body.task_id) !== taskId) ||
    progress === undefined
  ) return undefined;
  if (body.status === "process" && progress < 100) return "PENDING";
  if (body.status === "finish" && progress === 100) return "FINISHED";
  return undefined;
}

function taskProgress(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 100
      ? value
      : undefined;
  }
  if (typeof value !== "string" || !/^\d{1,3}%?$/u.test(value)) return undefined;
  const parsed = Number(value.replace(/%$/u, ""));
  return parsed >= 0 && parsed <= 100 ? parsed : undefined;
}

function providerFinishedAt(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 100
  );
}

function sameQueries(value: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const normalized = value.map((query) =>
    typeof query === "string" ? normalizedQuery(query) : undefined
  );
  return (
    normalized.every((query): query is string => query !== undefined) &&
    new Set(normalized).size === normalized.length &&
    normalized.every((query) => expected.includes(query))
  );
}

function valuesFromRecord(
  input: Readonly<Record<string, unknown>>,
  types: readonly SemanticFrequencyType[]
): Readonly<Record<SemanticFrequencyType, string>> | undefined {
  const aliases: Readonly<Record<SemanticFrequencyType, readonly string[]>> = {
    BASE: ["base", "ws", "ws_base"],
    EXACT: ["quoted", "ws_quoted", "phrase"],
    FIXED: ["overal", "overall", "ws_strict", "strict"]
  };
  const output: Partial<Record<SemanticFrequencyType, string>> = {};
  for (const type of types) {
    const values = aliases[type]
      .map((key) => decimal(input[key]))
      .filter((candidate): candidate is string => candidate !== undefined);
    if (new Set(values).size !== 1) return undefined;
    const resolved = values[0];
    if (resolved === undefined) return undefined;
    output[type] = resolved;
  }
  return output as Readonly<Record<SemanticFrequencyType, string>>;
}

function normalizedQueries(values: readonly string[]): readonly string[] {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > arsenkinWordstatKeywordLimit
  ) {
    throw new TypeError("Invalid Arsenkin Wordstat query batch");
  }
  const normalized = values.map(normalizedQuery);
  if (normalized.some((value) => value === undefined)) {
    throw new TypeError("Invalid Arsenkin Wordstat query batch");
  }
  return [...new Set(normalized as string[])];
}

function normalizedQuery(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized && normalized.length <= 400 ? normalized : undefined;
}

function providerFailure(
  status: number,
  value: unknown,
  retryAfterSeconds: number | undefined
): Exclude<ArsenkinWordstatSubmitResult, { readonly status: "ACCEPTED" | "OUTCOME_UNKNOWN" }> | undefined {
  const body = record(value);
  const code = typeof body?.code === "number" || typeof body?.code === "string"
    ? String(body.code)
    : undefined;
  if (status === 401 || status === 403 || code === "401" || code === "403") {
    return { status: "REJECTED", code: "INVALID_CREDENTIAL" };
  }
  if (status === 429 || code === "429") {
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
  if (
    status < 200 ||
    status >= 300 ||
    body?.status === "Error" ||
    body?.status === "error" ||
    Boolean(body?.error)
  ) {
    return { status: "REJECTED", code: "PROVIDER_PLAN_OR_REQUEST_REJECTED" };
  }
  return undefined;
}

function requestInit(secret: IntegrationCredentialSecret, body: unknown): RequestInit {
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

function arsenkinType(type: SemanticFrequencyType): "base" | "quoted" | "overal" {
  if (type === "BASE") return "base";
  if (type === "EXACT") return "quoted";
  return "overal";
}

function arsenkinDevice(device: SemanticFrequencyDevice): "" | "desktop" | "mobile" | "phone" | "tablet" {
  if (device === "ALL") return "";
  if (device === "DESKTOP") return "desktop";
  if (device === "MOBILE") return "mobile";
  if (device === "PHONE_ONLY") return "phone";
  return "tablet";
}

function providerRegionCode(value: string): string {
  const result = value === "ALL" ? "0" : value;
  if (!REGION_ID_PATTERN.test(result)) {
    throw new TypeError("Arsenkin Wordstat requires a numeric Yandex region id");
  }
  return result;
}

function taskIdValue(value: string): string {
  if (!TASK_ID_PATTERN.test(value)) throw new TypeError("Invalid Arsenkin task id");
  return value;
}

function taskIdFromUnknown(value: unknown): string | undefined {
  const result = typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : typeof value === "string" ? value : undefined;
  return result && TASK_ID_PATTERN.test(result) ? result : undefined;
}

function decimal(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && /^(?:0|[1-9]\d{0,18})$/u.test(value)
    ? value
    : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}
