import {
  arsenkinClusteringKeywordLimit,
  type ClusteringProposalTopUrl,
  type ClusteringDepth,
  type ClusteringFrequencyType,
  type ClusteringMethod,
  type ClusteringSearchEngine
} from "@seo-platform/contracts";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import type { ArsenkinHttpRateLimitGate } from "../integrations/arsenkin-http-rate-limiter.js";
import {
  providerJsonRequest,
  ProviderTransportError
} from "../integrations/provider-json-request.js";

const SET_URL = new URL("https://arsenkin.ru/api/tools/set");
const CHECK_URL = new URL("https://arsenkin.ru/api/tools/check");
const GET_URL = new URL("https://arsenkin.ru/api/tools/get");
const TASK_ID_PATTERN = /^[a-z0-9_-]{1,100}$/iu;
const REGION_PATTERN = /^(?:0|[1-9]\d{0,9})$/u;
const RESULT_MAX_BYTES = 128 * 1_048_576;

export type ArsenkinClusteringSubmitResult =
  | { readonly status: "ACCEPTED"; readonly taskId: string }
  | { readonly status: "RETRYABLE_FAILURE"; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly status: "REJECTED"; readonly code: string }
  | { readonly status: "OUTCOME_UNKNOWN"; readonly code: "PROVIDER_TRANSPORT_AMBIGUOUS" };

export type ArsenkinClusteringFetchResult =
  | { readonly status: "READY"; readonly result: ArsenkinClusteringResult }
  | { readonly status: "PENDING"; readonly retryAfterSeconds: number }
  | { readonly status: "RETRYABLE_FAILURE"; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly status: "REJECTED"; readonly code: string };

export interface ArsenkinClusteringCluster {
  readonly sequence: number;
  readonly providerKey: string;
  readonly name: string;
  readonly topUrl?: string;
  readonly topUrls: readonly ClusteringProposalTopUrl[];
  readonly frequencySum?: string;
  readonly mainPageCount?: number;
}

export interface ArsenkinClusteringItem {
  readonly sequence: number;
  readonly query: string;
  readonly clusterSequence?: number;
  readonly frequency?: string;
  readonly exactFrequency?: string;
  readonly aggregatorsPercent?: number;
  readonly toponym?: string;
  readonly geoDependent?: boolean;
}

export interface ArsenkinClusteringResult {
  readonly clusters: readonly ArsenkinClusteringCluster[];
  readonly items: readonly ArsenkinClusteringItem[];
}

export interface ArsenkinClusteringRequestInput {
  readonly keywords: readonly string[];
  readonly searchEngine: ClusteringSearchEngine;
  readonly regionCode: string;
  readonly method: ClusteringMethod;
  readonly overlapCount: number;
  readonly depth: ClusteringDepth;
  readonly excludeMainPages: boolean;
  readonly stopDomains: readonly string[];
  readonly frequencyTypes: readonly ClusteringFrequencyType[];
}

export class ArsenkinClusteringConnector {
  public readonly version = "arsenkin-clustering@1.1.0";

  public constructor(
    private readonly rateLimiter: ArsenkinHttpRateLimitGate,
    private readonly fetcher: ProviderFetch = fetch
  ) {}

  public async submit(
    input: ArsenkinClusteringRequestInput,
    secret: IntegrationCredentialSecret,
    timeoutMs: number,
    beforeRequest?: () => Promise<boolean>
  ): Promise<ArsenkinClusteringSubmitResult> {
    const request = arsenkinClusteringRequest(input);
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
    input: Omit<ArsenkinClusteringRequestInput, "keywords">,
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<ArsenkinClusteringFetchResult> {
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
      if (taskStatus !== "FINISHED") return { status: "REJECTED", code: "PROVIDER_INVALID_RESPONSE" };
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
      const result = arsenkinClusteringValues(response.value, taskId, resolved, input);
      return result
        ? { status: "READY", result }
        : { status: "REJECTED", code: "PROVIDER_INVALID_RESPONSE" };
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return { status: "RETRYABLE_FAILURE", code: "PROVIDER_UNAVAILABLE" };
      }
      throw error;
    }
  }
}

export function arsenkinClusteringRequest(input: ArsenkinClusteringRequestInput) {
  const queries = normalizedQueries(input.keywords);
  if (
    !REGION_PATTERN.test(input.regionCode) ||
    !Number.isSafeInteger(input.overlapCount) ||
    input.overlapCount < 2 ||
    input.overlapCount > 10 ||
    ![10, 20, 30].includes(input.depth) ||
    input.stopDomains.length > 100
  ) throw new TypeError("Invalid Arsenkin clustering request");
  return {
    tools_name: "clustering" as const,
    data: {
      queries,
      se: input.searchEngine === "YANDEX" ? 1 as const : 2 as const,
      region: Number(input.regionCode),
      group: input.method === "HARD" ? "hard" as const : "soft" as const,
      count: input.overlapCount,
      depth: input.depth,
      stoplist: [...input.stopDomains],
      ws: input.frequencyTypes.map(arsenkinFrequencyType),
      main: input.excludeMainPages
    }
  };
}

function arsenkinFrequencyType(
  value: ClusteringFrequencyType
): "base" | "quoted" | "overal" | "exact" {
  return ({
    BASE: "base",
    QUOTED: "quoted",
    OVERALL: "overal",
    EXACT: "exact"
  } as const)[value];
}

export function arsenkinClusteringValues(
  value: unknown,
  taskIdInput: string,
  keywords: readonly string[],
  input: Omit<ArsenkinClusteringRequestInput, "keywords">
): ArsenkinClusteringResult | undefined {
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
  const info = record(result.info);
  if (
    info &&
    ((input.searchEngine === "YANDEX" && !["Яндекс", "Yandex", 1].includes(info.se as never)) ||
      (input.searchEngine === "GOOGLE" && !["Google", 2].includes(info.se as never)))
  ) return undefined;
  const rows = providerRows(result, queries);
  if (!rows) return undefined;
  const expectedByKey = new Map(queries.map((query, sequence) => [queryKey(query), { query, sequence }]));
  const seen = new Set<string>();
  const clusterSequenceByKey = new Map<string, number>();
  const clusters: ArsenkinClusteringCluster[] = [];
  const items: ArsenkinClusteringItem[] = [];
  for (const providerRow of rows) {
    const row = record(providerRow.value);
    const queryValue = providerRow.query ?? stringField(row, ["query", "word", "keyword", "words", "Запрос", "Поисковые запросы"]);
    if (!row || !queryValue) return undefined;
    const expected = expectedByKey.get(queryKey(queryValue));
    if (!expected || seen.has(queryKey(queryValue))) return undefined;
    seen.add(queryKey(queryValue));
    const clusterName = cleanOptionalString(
      providerRow.clusterName ?? stringField(row, ["clustered", "cluster", "group", "cluster_name", "group_name", "Название группы"]),
      255
    );
    let clusterSequence: number | undefined;
    if (clusterName) {
      const clusterKey = queryKey(clusterName);
      clusterSequence = clusterSequenceByKey.get(clusterKey);
      const topUrl = httpUrl(field(row, ["topurl", "top_url", "topUrl", "Топ URL группы"]));
      const topUrls = providerTopUrls(
        field(row, ["topurls", "top_urls", "topUrls", "URL группы"]),
        topUrl
      );
      const frequencySum = nonNegativeDecimal(field(row, ["wssumm", "frequency_sum", "frequencySum", "Суммарная частотность кластера"]));
      const mainPageCount = nonNegativeInteger(field(row, ["main", "main_pages", "mainPageCount", "Главных страниц"]));
      if (clusterSequence === undefined) {
        clusterSequence = clusters.length;
        clusterSequenceByKey.set(clusterKey, clusterSequence);
        clusters.push({
          sequence: clusterSequence,
          providerKey: clusterKey.slice(0, 255),
          name: clusterName,
          ...(topUrl ? { topUrl } : {}),
          topUrls,
          ...(frequencySum ? { frequencySum } : {}),
          ...(mainPageCount === undefined ? {} : { mainPageCount })
        });
      } else {
        const current = clusters[clusterSequence];
        if (!current) return undefined;
        if (
          (current.frequencySum !== undefined && frequencySum !== undefined && current.frequencySum !== frequencySum) ||
          (current.mainPageCount !== undefined && mainPageCount !== undefined && current.mainPageCount !== mainPageCount)
        ) return undefined;
        clusters[clusterSequence] = {
          ...current,
          ...(!current.topUrl && topUrl ? { topUrl } : {}),
          topUrls: mergeTopUrls(current.topUrls, topUrls),
          ...(current.frequencySum === undefined && frequencySum
            ? { frequencySum }
            : {}),
          ...(current.mainPageCount === undefined && mainPageCount !== undefined
            ? { mainPageCount }
            : {})
        };
      }
    }
    const frequency = nonNegativeDecimal(field(row, ["ws", "frequency", "Общая частота"]));
    const exactFrequency = nonNegativeDecimal(field(row, ["ws_strict", "exact_frequency", "exactFrequency", "Точная частота"]));
    const aggregatorsPercent = percent(field(row, ["agregators", "aggregators", "aggregators_percent", "% Агрегаторов"]));
    const toponym = cleanOptionalString(stringField(row, ["toponim", "toponym", "Топоним"]), 255);
    const geoDependent = providerBoolean(field(row, ["geo", "geo_dependent", "geoDependent", "Геозависимость"]));
    items.push({
      sequence: expected.sequence,
      query: expected.query,
      ...(clusterSequence === undefined ? {} : { clusterSequence }),
      ...(frequency ? { frequency } : {}),
      ...(exactFrequency ? { exactFrequency } : {}),
      ...(aggregatorsPercent === undefined ? {} : { aggregatorsPercent }),
      ...(toponym ? { toponym } : {}),
      ...(geoDependent === undefined ? {} : { geoDependent })
    });
  }
  if (seen.size !== queries.length || items.length !== queries.length) return undefined;
  return {
    clusters,
    items: items.sort((left, right) => left.sequence - right.sequence)
  };
}

function providerRows(
  result: Readonly<Record<string, unknown>>,
  expected: readonly string[]
): readonly { readonly query?: string; readonly clusterName?: string; readonly value: unknown }[] | undefined {
  const clustering = record(result.clustering);
  if (clustering) return nestedClusteringRows(clustering, expected.length);
  if (Array.isArray(result.table)) {
    if (Array.isArray(result.queries)) {
      const table = result.table;
      const queryValues = result.queries;
      if (table.length !== expected.length || queryValues.length !== expected.length) return undefined;
      return table.map((value, index) => {
        const query = queryValues[index];
        return {
          ...(typeof query === "string" ? { query } : {}),
          value
        };
      });
    }
    return result.table.map((value) => ({ value }));
  }
  if (Array.isArray(result.clustered)) {
    const grouped: { query?: string; clusterName?: string; value: unknown }[] = [];
    let isGrouped = false;
    for (const candidate of result.clustered) {
      const cluster = record(candidate);
      const words = cluster?.words;
      if (cluster && Array.isArray(words)) {
        isGrouped = true;
        const name = stringField(cluster, ["name", "title", "clustered", "cluster", "group", "group_name"]);
        for (const word of words) {
          grouped.push({
            ...(typeof word === "string" ? { query: word } : {}),
            ...(name ? { clusterName: name } : {}),
            value: groupedWordValue(cluster, word)
          });
        }
      } else {
        grouped.push({ value: candidate });
      }
    }
    if (Array.isArray(result.unclustered)) {
      for (const word of result.unclustered) {
        grouped.push({
          ...(typeof word === "string" ? { query: word } : {}),
          value: typeof word === "string" ? { query: word } : word
        });
      }
    }
    return isGrouped || grouped.length === expected.length ? grouped : undefined;
  }
  const clustered = record(result.clustered);
  if (clustered) {
    const grouped: { query?: string; clusterName?: string; value: unknown }[] = [];
    for (const [name, words] of Object.entries(clustered)) {
      if (!Array.isArray(words)) return undefined;
      for (const word of words) {
        grouped.push({
          ...(typeof word === "string" ? { query: word } : {}),
          clusterName: name,
          value: typeof word === "string" ? { query: word } : word
        });
      }
    }
    if (Array.isArray(result.unclustered)) {
      for (const word of result.unclustered) {
        grouped.push({
          ...(typeof word === "string" ? { query: word } : {}),
          value: typeof word === "string" ? { query: word } : word
        });
      }
    }
    return grouped;
  }
  return undefined;
}

function nestedClusteringRows(
  clustering: Readonly<Record<string, unknown>>,
  expectedCount: number
): readonly {
  readonly query?: string;
  readonly clusterName?: string;
  readonly value: unknown;
}[] | undefined {
  const clustered = record(clustering.clustered);
  const single = record(clustering.single);
  if (!clustered && !single) return undefined;
  const rows: Array<{
    query?: string;
    clusterName?: string;
    value: unknown;
  }> = [];
  for (const [clusterName, candidate] of Object.entries(clustered ?? {})) {
    const cluster = record(candidate);
    const words = record(cluster?.words);
    if (!cluster || !words || Object.keys(words).length === 0) {
      return undefined;
    }
    for (const [query, word] of Object.entries(words)) {
      const value = nestedClusteringWordValue(cluster, query, word);
      if (!value) return undefined;
      rows.push({ query, clusterName, value });
      if (rows.length > expectedCount) return undefined;
    }
  }
  for (const [singleQuery, candidate] of Object.entries(single ?? {})) {
    const singleValue = record(candidate);
    if (!singleValue) return undefined;
    const words = record(singleValue.words);
    if (words) {
      if (Object.keys(words).length === 0) return undefined;
      for (const [query, word] of Object.entries(words)) {
        const value = nestedClusteringWordValue(singleValue, query, word);
        if (!value) return undefined;
        rows.push({ query, value });
        if (rows.length > expectedCount) return undefined;
      }
      continue;
    }
    const value = singleClusteringWordValue(singleQuery, singleValue);
    rows.push({ query: singleQuery, value });
    if (rows.length > expectedCount) return undefined;
  }
  return rows.length === expectedCount ? rows : undefined;
}

function nestedClusteringWordValue(
  cluster: Readonly<Record<string, unknown>>,
  query: string,
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  const word = record(value);
  if (!word) return undefined;
  const {
    words: _words,
    ...clusterFields
  } = cluster;
  const { main: _wordMain, ...wordFields } = word;
  return { ...clusterFields, ...wordFields, query };
}

function singleClusteringWordValue(
  query: string,
  value: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const {
    words: _words,
    main: _wordMain,
    ...wordFields
  } = value;
  return { ...wordFields, query };
}

function groupedWordValue(
  cluster: Readonly<Record<string, unknown>>,
  word: unknown
): Readonly<Record<string, unknown>> | unknown {
  const item = record(word);
  if (!item && typeof word !== "string") return word;
  const { words: _words, ...clusterFields } = cluster;
  return {
    ...clusterFields,
    ...(item ?? { query: word })
  };
}

function providerFailure(
  status: number,
  value: unknown,
  retryAfterSeconds?: number
): Exclude<ArsenkinClusteringSubmitResult, { readonly status: "ACCEPTED" | "OUTCOME_UNKNOWN" }> | undefined {
  const body = record(value);
  const code = typeof body?.code === "number" || typeof body?.code === "string" ? String(body.code) : undefined;
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
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
  if (typeof value !== "string" || !/^\d{1,3}%?$/u.test(value)) return undefined;
  const result = Number(value.replace(/%$/u, ""));
  return result >= 0 && result <= 100 ? result : undefined;
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
  if (!Array.isArray(values) || values.length < 1 || values.length > arsenkinClusteringKeywordLimit) {
    throw new TypeError("Invalid Arsenkin clustering query batch");
  }
  const result = values.map((value) => value.normalize("NFKC").trim().replace(/\s+/gu, " "));
  const keys = result.map(queryKey);
  if (
    result.some((value) => !value || value.length > 400) ||
    new Set(keys).size !== result.length
  ) throw new TypeError("Invalid Arsenkin clustering query batch");
  return result;
}

function queryKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

function field(row: Readonly<Record<string, unknown>> | undefined, keys: readonly string[]): unknown {
  if (!row) return undefined;
  for (const key of keys) if (key in row) return row[key];
  return undefined;
}

function stringField(row: Readonly<Record<string, unknown>> | undefined, keys: readonly string[]): string | undefined {
  const value = field(row, keys);
  return typeof value === "string" ? value : undefined;
}

function cleanOptionalString(value: unknown, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const result = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return result && result.length <= maximum ? result : undefined;
}

function nonNegativeDecimal(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/gu, "");
  return /^(?:0|[1-9]\d{0,18})$/u.test(normalized) ? normalized : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const result = typeof value === "string" && /^\d+$/u.test(value.trim()) ? Number(value.trim()) : value;
  return Number.isSafeInteger(result) && Number(result) >= 0 && Number(result) <= 100_000
    ? Number(result)
    : undefined;
}

function percent(value: unknown): number | undefined {
  const normalized = typeof value === "string" ? value.trim().replace(/%$/u, "") : value;
  const result = typeof normalized === "string" && /^\d+(?:[.,]\d+)?$/u.test(normalized)
    ? Number(normalized.replace(",", "."))
    : normalized;
  return typeof result === "number" && Number.isFinite(result) && result >= 0 && result <= 100
    ? result
    : undefined;
}

function providerBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === "1" || value === "Да" || value === "да") return true;
  if (value === false || value === 0 || value === "0" || value === "Нет" || value === "нет") return false;
  return undefined;
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

function providerTopUrls(
  value: unknown,
  fallback?: string
): readonly ClusteringProposalTopUrl[] {
  const candidates: ClusteringProposalTopUrl[] = [];
  const append = (rawUrl: unknown, rawCount?: unknown): void => {
    const url = httpUrl(rawUrl);
    if (!url) return;
    const overlapCount = nonNegativeInteger(rawCount);
    candidates.push({
      url,
      ...(overlapCount === undefined ? {} : { overlapCount })
    });
  };

  if (Array.isArray(value)) {
    for (const candidate of value.slice(0, 100)) {
      if (typeof candidate === "string") {
        append(candidate);
        continue;
      }
      const item = record(candidate);
      if (item) {
        append(
          field(item, ["url", "link", "href"]),
          field(item, ["count", "overlap", "matches", "queries"])
        );
      }
    }
  } else {
    const mapping = record(value);
    for (const [key, candidate] of Object.entries(mapping ?? {}).slice(0, 100)) {
      if (httpUrl(key)) {
        const details = record(candidate);
        append(
          key,
          details
            ? field(details, ["count", "overlap", "matches", "queries"])
            : candidate
        );
        continue;
      }
      const details = record(candidate);
      if (details) {
        append(
          field(details, ["url", "link", "href"]),
          field(details, ["count", "overlap", "matches", "queries"])
        );
      }
    }
  }
  if (fallback) append(fallback);
  return mergeTopUrls([], candidates).slice(0, 100);
}

function mergeTopUrls(
  left: readonly ClusteringProposalTopUrl[],
  right: readonly ClusteringProposalTopUrl[]
): readonly ClusteringProposalTopUrl[] {
  const byUrl = new Map<string, ClusteringProposalTopUrl>();
  for (const candidate of [...left, ...right]) {
    const current = byUrl.get(candidate.url);
    if (
      !current ||
      (candidate.overlapCount ?? -1) > (current.overlapCount ?? -1)
    ) {
      byUrl.set(candidate.url, candidate);
    }
  }
  return [...byUrl.values()];
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
