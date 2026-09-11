import type {
  WordstatExpansionDevice
} from "@seo-platform/contracts";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import type { ArsenkinHttpRateLimitGate } from "../integrations/arsenkin-http-rate-limiter.js";
import { arsenkinTaskLifecycle } from "../integrations/arsenkin-task-status.js";
import {
  providerJsonRequest,
  ProviderTransportError
} from "../integrations/provider-json-request.js";

const SET_URL = new URL("https://arsenkin.ru/api/tools/set");
const CHECK_URL = new URL("https://arsenkin.ru/api/tools/check");
const GET_URL = new URL("https://arsenkin.ru/api/tools/get");
const TASK_ID_PATTERN = /^[a-z0-9_-]{1,100}$/iu;
const MAX_RESULT_BYTES = 64 * 1_048_576;

export interface ArsenkinWordstatExpansionRow {
  readonly keyword: string;
  readonly frequencyBase: number;
  readonly sourceQuery: string;
  readonly sourceColumn: "LEFT" | "RIGHT";
}

export type ArsenkinWordstatExpansionSubmitResult =
  | { readonly status: "ACCEPTED"; readonly taskId: string }
  | { readonly status: "RETRYABLE_FAILURE"; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly status: "REJECTED"; readonly code: string }
  | { readonly status: "OUTCOME_UNKNOWN"; readonly code: "PROVIDER_TRANSPORT_AMBIGUOUS" };

export type ArsenkinWordstatExpansionFetchResult =
  | { readonly status: "READY"; readonly rows: readonly ArsenkinWordstatExpansionRow[]; readonly raw: unknown }
  | { readonly status: "PENDING"; readonly retryAfterSeconds: number }
  | { readonly status: "RETRYABLE_FAILURE"; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly status: "REJECTED"; readonly code: string };

export interface ArsenkinWordstatExpansionInput {
  readonly queries: readonly string[];
  readonly regionCode: string;
  readonly device: WordstatExpansionDevice;
  readonly minusWords: readonly string[];
  readonly clearMinusPhrases: boolean;
  readonly includeRightColumn: boolean;
  readonly clearPlus: boolean;
  readonly maxKeywords: number;
}

export class ArsenkinWordstatExpansionConnector {
  public readonly version = "arsenkin-wordstat-expansion@1.0.1";

  public constructor(
    private readonly rateLimiter: ArsenkinHttpRateLimitGate,
    private readonly fetcher: ProviderFetch = fetch
  ) {}

  public async submit(
    input: ArsenkinWordstatExpansionInput,
    secret: IntegrationCredentialSecret,
    timeoutMs: number,
    beforeRequest?: () => Promise<boolean>
  ): Promise<ArsenkinWordstatExpansionSubmitResult> {
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
        SET_URL,
        requestInit(secret, requestBody(input)),
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
    input: ArsenkinWordstatExpansionInput,
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<ArsenkinWordstatExpansionFetchResult> {
    const taskId = taskIdValue(taskIdInput);
    const checkPermit = await this.rateLimiter.tryAcquire();
    if (!checkPermit.allowed) return rateLimited(checkPermit.retryAfterSeconds);
    try {
      const check = await providerJsonRequest(
        CHECK_URL,
        requestInit(secret, { task_id: taskId }),
        timeoutMs,
        this.fetcher
      );
      const checkFailure = providerFailure(check.status, check.value, check.retryAfterSeconds);
      if (checkFailure) return checkFailure;
      const status = taskStatus(check.value, taskId);
      if (status === "PENDING") return { status, retryAfterSeconds: 5 };
      if (status !== "FINISHED") {
        return { status: "REJECTED", code: "PROVIDER_INVALID_RESPONSE" };
      }
      const getPermit = await this.rateLimiter.tryAcquire();
      if (!getPermit.allowed) return rateLimited(getPermit.retryAfterSeconds);
      const response = await providerJsonRequest(
        GET_URL,
        requestInit(secret, { task_id: taskId }),
        timeoutMs,
        this.fetcher,
        Date.now,
        MAX_RESULT_BYTES
      );
      const failure = providerFailure(
        response.status,
        response.value,
        response.retryAfterSeconds
      );
      if (failure) return failure;
      const rows = parseResult(response.value, taskId, input.queries, input.maxKeywords);
      return rows
        ? { status: "READY", rows, raw: response.value }
        : { status: "REJECTED", code: "PROVIDER_INVALID_RESPONSE" };
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return { status: "RETRYABLE_FAILURE", code: "PROVIDER_UNAVAILABLE" };
      }
      throw error;
    }
  }
}

export function requestBody(input: ArsenkinWordstatExpansionInput) {
  const queries = normalizedQueries(input.queries);
  const minusWords = normalizedPhrases(input.minusWords, 100, 100, true);
  if (!/^\d{1,10}$/u.test(input.regionCode)) {
    throw new TypeError("Arsenkin Wordstat requires a numeric Yandex region id");
  }
  return {
    tools_name: "wordstat" as const,
    data: {
      type: 2 as const,
      queries,
      device: device(input.device),
      region: Number(input.regionCode),
      minus_words: minusWords,
      is_clear_minus: input.clearMinusPhrases,
      is_right: input.includeRightColumn,
      is_clear: input.clearPlus
    }
  };
}

export function parseResult(
  value: unknown,
  taskIdInput: string,
  inputQueries: readonly string[],
  maxKeywords: number
): readonly ArsenkinWordstatExpansionRow[] | undefined {
  const taskId = taskIdValue(taskIdInput);
  const body = record(value);
  const result = record(body?.result);
  const dataRecord = record(result?.data);
  const dataRows = Array.isArray(result?.data) ? result.data : dataRecord;
  if (
    body?.code !== "TASK_RESULT" ||
    taskIdFromUnknown(body.task_id) !== taskId ||
    result?.type !== 2 ||
    !dataRows ||
    !Number.isSafeInteger(maxKeywords) ||
    maxKeywords < 1 ||
    maxKeywords > 10_000
  ) return undefined;
  let queries: readonly string[];
  try {
    queries = normalizedQueries(inputQueries);
  } catch {
    return undefined;
  }
  const echoed = Array.isArray(result.queries)
    ? result.queries
    : Array.isArray(dataRecord?.queries)
      ? dataRecord.queries
      : undefined;
  if (echoed && !sameQueries(echoed, queries)) return undefined;
  if (Array.isArray(dataRows) && dataRows.length !== queries.length) return undefined;

  const output = new Map<string, ArsenkinWordstatExpansionRow>();
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    if (!query) return undefined;
    const block = record(
      Array.isArray(dataRows) ? dataRows[index] : dataRows[String(index)]
    );
    if (!block) return undefined;
    const seedFrequency = nonNegativeInteger(block.freq);
    if (seedFrequency === undefined) return undefined;
    addRow(output, query, seedFrequency, query, "LEFT", maxKeywords);
    if (!appendColumn(output, block.left, query, "LEFT", maxKeywords)) return undefined;
    if (!appendColumn(output, block.right, query, "RIGHT", maxKeywords, true)) return undefined;
  }
  return [...output.values()].slice(0, maxKeywords);
}

function appendColumn(
  output: Map<string, ArsenkinWordstatExpansionRow>,
  value: unknown,
  sourceQuery: string,
  column: "LEFT" | "RIGHT",
  maxKeywords: number,
  optional = false
): boolean {
  if (value === undefined && optional) return true;
  const rows = record(value);
  if (!rows) return false;
  for (const [keyword, rawFrequency] of Object.entries(rows)) {
    const normalized = normalizedPhrase(keyword, 2_000);
    const frequency = nonNegativeInteger(rawFrequency);
    if (!normalized || frequency === undefined) return false;
    addRow(output, normalized, frequency, sourceQuery, column, maxKeywords);
  }
  return true;
}

function addRow(
  output: Map<string, ArsenkinWordstatExpansionRow>,
  keyword: string,
  frequencyBase: number,
  sourceQuery: string,
  sourceColumn: "LEFT" | "RIGHT",
  maxKeywords: number
): void {
  const key = keyword.toLocaleLowerCase("ru-RU");
  const current = output.get(key);
  if (current) {
    if (frequencyBase > current.frequencyBase) {
      output.set(key, { ...current, frequencyBase });
    }
    return;
  }
  if (output.size >= maxKeywords) return;
  output.set(key, { keyword, frequencyBase, sourceQuery, sourceColumn });
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

function device(value: WordstatExpansionDevice): "" | "desktop" | "mobile" | "phone" | "tablet" {
  if (value === "ALL") return "";
  if (value === "DESKTOP") return "desktop";
  if (value === "MOBILE") return "mobile";
  if (value === "PHONE_ONLY") return "phone";
  return "tablet";
}

function taskStatus(value: unknown, taskId: string): "PENDING" | "FINISHED" | undefined {
  const body = record(value);
  const lifecycle = arsenkinTaskLifecycle(body?.status, body?.progress);
  if (
    body?.code !== "TASK_STATUS" ||
    (body.task_id !== undefined && taskIdFromUnknown(body.task_id) !== taskId) ||
    lifecycle === undefined
  ) return undefined;
  return lifecycle;
}

function providerFailure(
  status: number,
  value: unknown,
  retryAfterSeconds?: number
): Exclude<ArsenkinWordstatExpansionSubmitResult, { readonly status: "ACCEPTED" | "OUTCOME_UNKNOWN" }> | undefined {
  const body = record(value);
  const code = typeof body?.code === "number" || typeof body?.code === "string"
    ? String(body.code)
    : undefined;
  if (status === 401 || status === 403 || code === "401" || code === "403") {
    return { status: "REJECTED", code: "INVALID_CREDENTIAL" };
  }
  if (status === 429 || code === "429") {
    return { status: "RETRYABLE_FAILURE", code: "PROVIDER_RATE_LIMITED", ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
  }
  if (status >= 500) {
    return { status: "RETRYABLE_FAILURE", code: "PROVIDER_UNAVAILABLE", ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) };
  }
  if (status < 200 || status >= 300 || body?.status === "Error" || body?.status === "error" || Boolean(body?.error)) {
    return { status: "REJECTED", code: "PROVIDER_PLAN_OR_REQUEST_REJECTED" };
  }
  return undefined;
}

function rateLimited(retryAfterSeconds: number): {
  readonly status: "RETRYABLE_FAILURE";
  readonly code: "PROVIDER_RATE_LIMITED";
  readonly retryAfterSeconds: number;
} {
  return { status: "RETRYABLE_FAILURE", code: "PROVIDER_RATE_LIMITED", retryAfterSeconds };
}

function normalizedQueries(values: readonly string[]): readonly string[] {
  const normalized = normalizedPhrases(values, 500, 400);
  if (new Set(normalized.map((value) => value.toLocaleLowerCase("ru-RU"))).size !== normalized.length) {
    throw new TypeError("Duplicate Arsenkin Wordstat queries");
  }
  return normalized;
}

function normalizedPhrases(
  values: readonly string[],
  maxItems: number,
  maxLength: number,
  allowEmpty = false
): readonly string[] {
  if (!Array.isArray(values) || (!allowEmpty && values.length < 1) || values.length > maxItems) {
    throw new TypeError("Invalid Arsenkin Wordstat phrases");
  }
  const output = values.map((value) => normalizedPhrase(value, maxLength));
  if (output.some((value) => value === undefined)) {
    throw new TypeError("Invalid Arsenkin Wordstat phrase");
  }
  return output as readonly string[];
}

function normalizedPhrase(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function sameQueries(value: readonly unknown[], expected: readonly string[]): boolean {
  if (value.length !== expected.length) return false;
  const normalized = value.map((item) => normalizedPhrase(item, 400));
  return normalized.every((item, index) => item === expected[index]);
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

function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  return Number.isSafeInteger(parsed) && Number(parsed) >= 0 && Number(parsed) <= 2_147_483_647
    ? Number(parsed)
    : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}
