import { Parser } from "htmlparser2";
import type {
  AiAnswerDevice,
  AiAnswerSearchEngine,
  InternalAiAnswerSnapshotValue
} from "@seo-platform/contracts";
import { arsenkinAiAnswerKeywordLimit } from "@seo-platform/contracts";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
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
const REGION_PATTERN = /^(?:0|[1-9]\d{0,9})$/u;
const RESULT_MAX_BYTES = 64 * 1_048_576;

export type ArsenkinAiAnswerSubmitResult =
  | { readonly status: "ACCEPTED"; readonly taskId: string }
  | { readonly status: "RETRYABLE_FAILURE"; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly status: "REJECTED"; readonly code: string }
  | { readonly status: "OUTCOME_UNKNOWN"; readonly code: "PROVIDER_TRANSPORT_AMBIGUOUS" };

export type ArsenkinAiAnswerFetchResult =
  | { readonly status: "READY"; readonly results: readonly ArsenkinAiAnswerQueryResult[] }
  | { readonly status: "PENDING"; readonly retryAfterSeconds: number }
  | { readonly status: "RETRYABLE_FAILURE"; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly status: "REJECTED"; readonly code: string };

export interface ArsenkinAiAnswerQueryResult {
  readonly query: string;
  readonly snapshot: InternalAiAnswerSnapshotValue;
}

export class ArsenkinAiAnswerConnector {
  public readonly version = "arsenkin-ai-serp@1.0.0";

  public constructor(
    private readonly rateLimiter: ArsenkinHttpRateLimitGate,
    private readonly fetcher: ProviderFetch = fetch
  ) {}

  public async submit(
    input: ArsenkinAiAnswerRequestInput,
    secret: IntegrationCredentialSecret,
    timeoutMs: number,
    beforeRequest?: () => Promise<boolean>
  ): Promise<ArsenkinAiAnswerSubmitResult> {
    const request = arsenkinAiAnswerRequest(input);
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
        requestInit(secret, request),
        timeoutMs,
        this.fetcher
      );
      const failure = providerFailure(response.status, response.value, response.retryAfterSeconds);
      if (failure) return failure;
      const taskId = taskIdFromUnknown(record(response.value)?.task_id);
      return taskId
        ? { status: "ACCEPTED", taskId }
        : { status: "REJECTED", code: "PROVIDER_INVALID_RESPONSE" };
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return { status: "OUTCOME_UNKNOWN", code: "PROVIDER_TRANSPORT_AMBIGUOUS" };
      }
      throw error;
    }
  }

  public async fetchResult(
    taskIdInput: string,
    keywords: readonly string[] | (() => Promise<readonly string[]>),
    input: Omit<ArsenkinAiAnswerRequestInput, "keywords">,
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<ArsenkinAiAnswerFetchResult> {
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
      const taskStatus = arsenkinTaskStatus(check.value, taskId);
      if (taskStatus === "PENDING") return { status: "PENDING", retryAfterSeconds: 5 };
      if (taskStatus !== "FINISHED") {
        return { status: "REJECTED", code: "PROVIDER_INVALID_RESPONSE" };
      }
      const resolved = typeof keywords === "function" ? await keywords() : keywords;
      const getPermit = await this.rateLimiter.tryAcquire();
      if (!getPermit.allowed) return rateLimited(getPermit.retryAfterSeconds);
      const response = await providerJsonRequest(
        GET_URL,
        requestInit(secret, { task_id: taskId }),
        timeoutMs,
        this.fetcher,
        Date.now,
        RESULT_MAX_BYTES
      );
      const failure = providerFailure(response.status, response.value, response.retryAfterSeconds);
      if (failure) return failure;
      const results = arsenkinAiAnswerValues(response.value, taskId, resolved, input);
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

export interface ArsenkinAiAnswerRequestInput {
  readonly keywords: readonly string[];
  readonly searchEngine: AiAnswerSearchEngine;
  readonly regionCode: string;
  readonly device: AiAnswerDevice;
  readonly host: string;
  readonly excludeSubdomains: boolean;
  readonly brands: readonly string[];
}

export function arsenkinAiAnswerRequest(input: ArsenkinAiAnswerRequestInput) {
  const queries = normalizedQueries(input.keywords);
  const region = providerRegion(input.regionCode);
  if (!/^[a-z0-9.-]{1,253}$/iu.test(input.host) || input.brands.length > 10) {
    throw new TypeError("Invalid Arsenkin AI answer request");
  }
  return {
    tools_name: "ai-serp" as const,
    data: {
      queries,
      se: input.searchEngine === "YANDEX" ? 1 as const : 2 as const,
      region,
      device: input.device === "MOBILE" ? "mobile" as const : "desktop" as const,
      host: input.host,
      subdomain: input.excludeSubdomains,
      brands: [...input.brands]
    }
  };
}

export function arsenkinAiAnswerValues(
  value: unknown,
  taskIdInput: string,
  keywords: readonly string[],
  input: Omit<ArsenkinAiAnswerRequestInput, "keywords">
): readonly ArsenkinAiAnswerQueryResult[] | undefined {
  const taskId = taskIdValue(taskIdInput);
  const body = record(value);
  const result = record(body?.result);
  if (
    body?.code !== "TASK_RESULT" ||
    taskIdFromUnknown(body.task_id) !== taskId ||
    !result
  ) return undefined;
  let queries: readonly string[];
  try {
    queries = normalizedQueries(keywords);
  } catch {
    return undefined;
  }
  const alignedRows = alignProviderRows(result.queries, result.table, queries);
  if (!alignedRows) return undefined;
  const info = record(result.info);
  if (
    info &&
    ((input.searchEngine === "YANDEX" && info.se !== "Яндекс") ||
      (input.searchEngine === "GOOGLE" && info.se !== "Google"))
  ) return undefined;
  const singleQueryTopSources = queries.length === 1
    ? aggregateTopSources(result.top)
    : [];
  const output: ArsenkinAiAnswerQueryResult[] = [];
  for (const [index, query] of queries.entries()) {
    const row = record(alignedRows[index]);
    if (!row) return undefined;
    const answerPresent = providerBoolean(row.found);
    const brand = row.brand === undefined ? false : providerBoolean(row.brand);
    if (answerPresent === undefined || brand === undefined) return undefined;
    const details = typeof row.details === "string" ? row.details : "";
    if (details.length > 2_000_000) return undefined;
    const answerMarkdown = details.trim() ? aiAnswerHtmlToMarkdown(details) : undefined;
    if (answerMarkdown && answerMarkdown.length > 300_000) return undefined;
    const sourceValues = row.sources === undefined ? [] : row.sources;
    if (!Array.isArray(sourceValues) || sourceValues.length > 100) return undefined;
    const parsedSources = sourceValues.map((candidate) => source(candidate));
    if (parsedSources.some((candidate) => candidate === undefined)) return undefined;
    const sources = parsedSources.length > 0 || !answerPresent
      ? parsedSources
      : singleQueryTopSources;
    const position = record(row.position);
    const rank = positiveInteger(position?.position);
    const rankingUrl = httpUrl(position?.url);
    if ((rank === undefined) !== (rankingUrl === undefined)) return undefined;
    const siteFound = rank !== undefined && rankingUrl !== undefined;
    if (!answerPresent && (siteFound || brand || Boolean(answerMarkdown) || sources.length > 0)) {
      return undefined;
    }
    output.push({
      query,
      snapshot: {
        answerPresent,
        siteFound,
        ...(rank ? { position: rank } : {}),
        ...(rankingUrl ? { rankingUrl } : {}),
        brandFound: brand,
        ...(answerMarkdown ? { answerMarkdown } : {}),
        sources: sources as InternalAiAnswerSnapshotValue["sources"]
      }
    });
  }
  return output;
}

export function aiAnswerHtmlToMarkdown(html: string): string {
  let output = "";
  let ignoredDepth = 0;
  let codeDepth = 0;
  const append = (value: string) => { output += value; };
  const parser = new Parser({
    onopentag(name) {
      const tag = name.toLocaleLowerCase("en-US");
      if (tag === "script" || tag === "style") {
        ignoredDepth += 1;
        return;
      }
      if (ignoredDepth) return;
      if (/^h[1-6]$/u.test(tag)) append(`\n\n${"#".repeat(Number(tag[1]))} `);
      else if (tag === "p" || tag === "div" || tag === "blockquote") append("\n\n");
      else if (tag === "br") append("\n");
      else if (tag === "li") append("\n- ");
      else if (tag === "strong" || tag === "b") append("**");
      else if (tag === "em" || tag === "i") append("*");
      else if (tag === "code") { codeDepth += 1; append("`"); }
      else if (tag === "pre") { codeDepth += 1; append("\n\n```\n"); }
      else if (tag === "media") append("[Изображение]");
    },
    ontext(value) {
      if (ignoredDepth) return;
      append(
        codeDepth
          ? value
          : value.replace(/[\\`*_[\]{}()#+!<>|]/gu, "\\$&")
      );
    },
    onclosetag(name) {
      const tag = name.toLocaleLowerCase("en-US");
      if (tag === "script" || tag === "style") {
        ignoredDepth = Math.max(0, ignoredDepth - 1);
        return;
      }
      if (ignoredDepth) return;
      if (tag === "strong" || tag === "b") append("**");
      else if (tag === "em" || tag === "i") append("*");
      else if (tag === "code") { append("`"); codeDepth = Math.max(0, codeDepth - 1); }
      else if (tag === "pre") { append("\n```\n"); codeDepth = Math.max(0, codeDepth - 1); }
      else if (tag === "p" || tag === "div" || tag === "li" || /^h[1-6]$/u.test(tag)) append("\n");
    }
  }, { decodeEntities: true });
  parser.write(html);
  parser.end();
  return output
    .replace(/\r/gu, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/gu, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function source(value: unknown): InternalAiAnswerSnapshotValue["sources"][number] | undefined {
  const input = record(value);
  const url = httpUrl(input?.url);
  if (!input || !url) return undefined;
  const providerId = nonNegativeInteger(input.id);
  const title = nullableString(input.title, 4_000);
  const description = nullableString(input.description, 12_000);
  if (title === false || description === false) return undefined;
  return {
    ...(providerId === undefined ? {} : { providerId }),
    url,
    ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
    ...(typeof description === "string" && description.trim()
      ? { description: description.trim() }
      : {})
  };
}

function aggregateTopSources(
  value: unknown
): readonly InternalAiAnswerSnapshotValue["sources"][number][] {
  const top = record(value);
  const urls = record(top?.urls);
  if (!urls) return [];
  const entries = Object.entries(urls);
  if (entries.length < 1 || entries.length > 100) return [];
  const seen = new Set<string>();
  return entries.flatMap(([candidate, count]) => {
    const url = httpUrl(candidate);
    if (
      !url ||
      !Number.isSafeInteger(count) ||
      Number(count) < 1 ||
      seen.has(url)
    ) return [];
    seen.add(url);
    return [{ url }];
  });
}

function providerFailure(
  status: number,
  value: unknown,
  retryAfterSeconds?: number
): Exclude<ArsenkinAiAnswerSubmitResult, { readonly status: "ACCEPTED" | "OUTCOME_UNKNOWN" }> | undefined {
  const body = record(value);
  const code = typeof body?.code === "number" || typeof body?.code === "string"
    ? String(body.code)
    : undefined;
  if (status === 401 || status === 403 || code === "401" || code === "403") {
    return { status: "REJECTED", code: "INVALID_CREDENTIAL" };
  }
  if (status === 429 || code === "429") {
    return { status: "RETRYABLE_FAILURE", code: "PROVIDER_RATE_LIMITED", ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
  }
  if (status >= 500) {
    return { status: "RETRYABLE_FAILURE", code: "PROVIDER_UNAVAILABLE", ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
  }
  if (status < 200 || status >= 300 || String(body?.status).toLocaleLowerCase("en-US") === "error" || Boolean(body?.error)) {
    return { status: "REJECTED", code: "PROVIDER_PLAN_OR_REQUEST_REJECTED" };
  }
  return undefined;
}

function arsenkinTaskStatus(value: unknown, taskId: string): "PENDING" | "FINISHED" | undefined {
  const body = record(value);
  const lifecycle = arsenkinTaskLifecycle(body?.status, body?.progress);
  if (
    body?.code !== "TASK_STATUS" ||
    (body.task_id !== undefined && taskIdFromUnknown(body.task_id) !== taskId) ||
    lifecycle === undefined
  ) return undefined;
  return lifecycle;
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

function rateLimited(retryAfterSeconds: number) {
  return { status: "RETRYABLE_FAILURE" as const, code: "PROVIDER_RATE_LIMITED", retryAfterSeconds };
}

function normalizedQueries(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > arsenkinAiAnswerKeywordLimit) {
    throw new TypeError("Invalid Arsenkin AI answer query batch");
  }
  const result = values.map((value) => value.trim().replace(/\s+/gu, " "));
  if (result.some((value) => !value || value.length > 400) || new Set(result).size !== result.length) {
    throw new TypeError("Invalid Arsenkin AI answer query batch");
  }
  return result;
}

function alignProviderRows(
  queryValue: unknown,
  tableValue: unknown,
  expected: readonly string[]
): readonly unknown[] | undefined {
  if (
    !Array.isArray(queryValue) ||
    !Array.isArray(tableValue) ||
    queryValue.length !== expected.length ||
    tableValue.length !== expected.length
  ) return undefined;
  const providerQueries = queryValue.map((candidate) =>
    typeof candidate === "string"
      ? providerQueryKey(candidate)
      : undefined
  );
  const expectedKeys = expected.map(providerQueryKey);
  if (
    providerQueries.some((query) => query === undefined) ||
    new Set(providerQueries).size !== providerQueries.length ||
    new Set(expectedKeys).size !== expectedKeys.length
  ) return undefined;
  const rowsByQuery = new Map<string, unknown>();
  for (const [index, query] of providerQueries.entries()) {
    if (query === undefined || !expectedKeys.includes(query)) return undefined;
    rowsByQuery.set(query, tableValue[index]);
  }
  const aligned = expectedKeys.map((query) => rowsByQuery.get(query));
  return aligned.some((row) => row === undefined) ? undefined : aligned;
}

function providerQueryKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("ru-RU");
}

function providerRegion(value: string): number {
  if (!REGION_PATTERN.test(value)) throw new TypeError("Arsenkin AI answers require a numeric region id");
  return Number(value);
}

function providerBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100_000
    ? Number(value)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000
    ? Number(value)
    : undefined;
}

function nullableString(value: unknown, maximum: number): string | null | false {
  return value === null || value === undefined
    ? null
    : typeof value === "string" && value.length <= maximum
      ? value
      : false;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8_192) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
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

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}
