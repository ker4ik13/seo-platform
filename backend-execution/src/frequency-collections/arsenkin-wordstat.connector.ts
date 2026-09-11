import type {
  FrequencySeasonalityGranularity,
  FrequencySeasonalityRequest,
  SemanticFrequencyDevice,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import {
  arsenkinWordstatKeywordLimit,
  frequencySeasonalitySeriesPointLimit
} from "@seo-platform/contracts";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import type { ArsenkinHttpRateLimitGate } from "../integrations/arsenkin-http-rate-limiter.js";
import { arsenkinTaskLifecycle } from "../integrations/arsenkin-task-status.js";
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

export type ArsenkinSeasonalityFetchResult =
  | {
      readonly status: "READY";
      readonly results: readonly ArsenkinSeasonalityQueryResult[];
    }
  | { readonly status: "PENDING"; readonly retryAfterSeconds: number }
  | { readonly status: "RETRYABLE_FAILURE"; readonly code: string; readonly retryAfterSeconds?: number }
  | { readonly status: "REJECTED"; readonly code: string };

export interface ArsenkinWordstatQueryResult {
  readonly query: string;
  readonly values: Readonly<Record<SemanticFrequencyType, string>>;
}

export interface ArsenkinSeasonalityQueryResult {
  readonly query: string;
  readonly points: readonly Readonly<{
    periodStart: string;
    value: string;
    share?: string;
  }>[];
}

export class ArsenkinWordstatConnector {
  public readonly version = "arsenkin-wordstat@3.0.0";

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
    return this.submitRequest(
      arsenkinWordstatRequest(input),
      secret,
      timeoutMs,
      beforeRequest
    );
  }

  public async submitSeasonality(
    input: {
      readonly keywords: readonly string[];
      readonly regionCode: string;
      readonly device: SemanticFrequencyDevice;
      readonly seasonality: FrequencySeasonalityRequest;
    },
    secret: IntegrationCredentialSecret,
    timeoutMs: number,
    beforeRequest?: () => Promise<boolean>
  ): Promise<ArsenkinWordstatSubmitResult> {
    return this.submitRequest(
      arsenkinSeasonalityRequest(input),
      secret,
      timeoutMs,
      beforeRequest
    );
  }

  private async submitRequest(
    request: unknown,
    secret: IntegrationCredentialSecret,
    timeoutMs: number,
    beforeRequest?: () => Promise<boolean>
  ): Promise<ArsenkinWordstatSubmitResult> {
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

  public async fetchSeasonalityResult(
    taskIdInput: string,
    keywords: readonly string[] | (() => Promise<readonly string[]>),
    seasonality: FrequencySeasonalityRequest,
    regionCodeInput: string,
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<ArsenkinSeasonalityFetchResult> {
    const taskId = taskIdValue(taskIdInput);
    const regionCode = providerRegionCode(regionCodeInput);
    const checkPermit = await this.rateLimiter.tryAcquire();
    if (!checkPermit.allowed) return rateLimited(checkPermit.retryAfterSeconds);
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
      const resolvedKeywords = typeof keywords === "function"
        ? await keywords()
        : keywords;
      const getPermit = await this.rateLimiter.tryAcquire();
      if (!getPermit.allowed) return rateLimited(getPermit.retryAfterSeconds);
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
      const results = arsenkinSeasonalityBatchValues(
        resultResponse.value,
        taskId,
        resolvedKeywords,
        seasonality,
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

export function arsenkinSeasonalityRequest(input: {
  readonly keywords: readonly string[];
  readonly regionCode: string;
  readonly device: SemanticFrequencyDevice;
  readonly seasonality: FrequencySeasonalityRequest;
}) {
  const keywords = normalizedQueries(input.keywords);
  const regionCode = providerRegionCode(input.regionCode);
  return {
    tools_name: "wordstat" as const,
    data: {
      type: 3 as const,
      queries: keywords,
      device: arsenkinDevice(input.device),
      region: Number(regionCode),
      group: arsenkinSeasonalityGroup(input.seasonality.granularity),
      startdate: input.seasonality.observedFrom,
      enddate: input.seasonality.observedThrough,
      correct_dates: true
    }
  };
}

export function arsenkinSeasonalityBatchValues(
  value: unknown,
  taskIdInput: string,
  keywords: readonly string[],
  seasonality: FrequencySeasonalityRequest,
  regionCodeInput: string
): readonly ArsenkinSeasonalityQueryResult[] | undefined {
  const taskId = taskIdValue(taskIdInput);
  const regionCode = providerRegionCode(regionCodeInput);
  const body = record(value);
  if (
    body?.code !== "TASK_RESULT" ||
    taskIdFromUnknown(body.task_id) !== taskId ||
    (body.finished_at !== undefined && !providerFinishedAt(body.finished_at))
  ) return undefined;
  const envelope = record(body.result);
  if (
    (envelope?.type !== 3 && envelope?.type !== "3") ||
    (envelope.task_id !== undefined &&
      taskIdFromUnknown(envelope.task_id) !== taskId)
  ) {
    return undefined;
  }
  let queries: readonly string[];
  try {
    queries = normalizedQueries(keywords);
  } catch {
    return undefined;
  }
  const arrayRows = seasonalityResultRows(envelope.data, queries);
  if (arrayRows) {
    return arraySeasonalityResults(
      arrayRows,
      envelope.dates,
      queries,
      seasonality,
      regionCode
    );
  }
  const data = record(envelope.data);
  if (taskIdFromUnknown(data?.task_id) !== taskId) return undefined;
  if (!sameQueries(data?.queries, queries)) return undefined;
  const expectedGroup = arsenkinSeasonalityGroup(seasonality.granularity);
  if (data?.group !== undefined && data.group !== expectedGroup) return undefined;
  if (!compatibleSeasonalityRange(
    data?.startdate,
    data?.enddate,
    seasonality.observedFrom,
    seasonality.observedThrough
  )) {
    return undefined;
  }
  const responseRegion = data?.region;
  if (
    responseRegion !== undefined &&
    String(responseRegion) !== regionCode
  ) return undefined;
  const regions = record(data?.regions);
  if (regions && !(regionCode in regions)) return undefined;
  const providerResults = record(data?.result);
  if (!providerResults) return undefined;
  const requested = new Set(queries);
  const rows = new Map<string, readonly SeasonalityPoint[]>();
  for (const [rawQuery, rawValue] of Object.entries(providerResults)) {
    const query = normalizedQuery(rawQuery);
    if (!query || !requested.has(query) || rows.has(query)) return undefined;
    const points = seasonalityPoints(
      rawValue,
      regionCode,
      seasonality.granularity,
      seasonality.observedFrom,
      seasonality.observedThrough
    );
    if (!points) return undefined;
    rows.set(query, points);
  }
  return orderedSeasonalityResults(queries, rows);
}

function arraySeasonalityResults(
  value: readonly unknown[],
  datesValue: unknown,
  queries: readonly string[],
  seasonality: FrequencySeasonalityRequest,
  regionCode: string
): readonly ArsenkinSeasonalityQueryResult[] | undefined {
  if (value.length > queries.length) return undefined;
  const expectedDates = seasonalityDates(
    datesValue,
    seasonality.granularity,
    seasonality.observedFrom,
    seasonality.observedThrough
  );
  if (datesValue !== undefined && !expectedDates) return undefined;
  const requested = new Set(queries);
  const rows = new Map<string, readonly SeasonalityPoint[]>();
  for (const candidate of value) {
    const row = record(candidate);
    const query = typeof row?.query === "string"
      ? normalizedQuery(row.query)
      : undefined;
    if (!query || !requested.has(query) || rows.has(query)) return undefined;
    const parsedPoints = seasonalityPoints(
      row?.data,
      regionCode,
      seasonality.granularity,
      seasonality.observedFrom,
      seasonality.observedThrough
    );
    const points = expectedDates
      ? completeSeasonalityPoints(
          row?.data,
          parsedPoints,
          expectedDates,
          regionCode
        )
      : parsedPoints;
    if (!points) return undefined;
    rows.set(query, points);
  }
  if (rows.size !== queries.length) {
    if (!expectedDates) return undefined;
    for (const query of queries) {
      if (!rows.has(query)) rows.set(query, zeroSeasonalityPoints(expectedDates));
    }
  }
  return orderedSeasonalityResults(queries, rows);
}

function seasonalityResultRows(
  value: unknown,
  queries: readonly string[]
): readonly unknown[] | undefined {
  if (Array.isArray(value)) return value;
  const input = record(value);
  if (!input) return undefined;
  const entries = Object.entries(input);
  if (entries.length === 0) return undefined;
  if (entries.every(([key]) => /^(?:0|[1-9]\d{0,4})$/u.test(key))) {
    return entries
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, row]) => row);
  }
  const requested = new Set(queries);
  if (
    entries.length <= queries.length &&
    entries.every(([query]) => {
      const normalized = normalizedQuery(query);
      return normalized !== undefined && requested.has(normalized);
    })
  ) {
    return entries.map(([query, data]) => ({ query, data }));
  }
  return undefined;
}

function completeSeasonalityPoints(
  source: unknown,
  parsed: readonly SeasonalityPoint[] | undefined,
  expectedDates: readonly string[],
  regionCode: string
): readonly SeasonalityPoint[] | undefined {
  if (!parsed) {
    return emptySeasonalitySource(source, regionCode)
      ? zeroSeasonalityPoints(expectedDates)
      : undefined;
  }
  const byDate = new Map(parsed.map((point) => [point.periodStart, point]));
  if ([...byDate.keys()].some((date) => !expectedDates.includes(date))) {
    return undefined;
  }
  return expectedDates.map((periodStart) =>
    byDate.get(periodStart) ?? { periodStart, value: "0" }
  );
}

function zeroSeasonalityPoints(
  dates: readonly string[]
): readonly SeasonalityPoint[] {
  return dates.map((periodStart) => ({ periodStart, value: "0" }));
}

function emptySeasonalitySource(value: unknown, regionCode: string): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  const input = record(value);
  if (!input) return false;
  const keys = Object.keys(input);
  if (keys.length === 0) return true;
  return keys.length === 1 &&
    (keys[0] === regionCode || keys[0] === "data" || keys[0] === "dynamics")
    ? emptySeasonalitySource(input[keys[0]], regionCode)
    : false;
}

function seasonalityDates(
  value: unknown,
  granularity: FrequencySeasonalityGranularity,
  from: string,
  through: string
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > frequencySeasonalitySeriesPointLimit
  ) {
    return undefined;
  }
  const dates = value.map((candidate) => seasonalityDate(candidate, granularity));
  if (dates.some((candidate) => !candidate)) return undefined;
  const filtered = (dates as string[]).filter((date) => date >= from && date <= through);
  if (
    filtered.length === 0 ||
    new Set(dates).size !== dates.length ||
    dates.some((date, index) => index > 0 && date! <= dates[index - 1]!)
  ) return undefined;
  return filtered;
}

function orderedSeasonalityResults(
  queries: readonly string[],
  rows: ReadonlyMap<string, readonly SeasonalityPoint[]>
): readonly ArsenkinSeasonalityQueryResult[] | undefined {
  if (rows.size !== queries.length) return undefined;
  return queries.map((query) => ({ query, points: rows.get(query)! }));
}

interface SeasonalityPoint {
  readonly periodStart: string;
  readonly value: string;
  readonly share?: string;
}

function seasonalityPoints(
  value: unknown,
  regionCode: string,
  granularity: FrequencySeasonalityGranularity,
  from: string,
  through: string
): readonly SeasonalityPoint[] | undefined {
  const regionEnvelope = record(value);
  const scoped = regionEnvelope && regionCode in regionEnvelope
    ? regionEnvelope[regionCode]
    : value;
  const scopedRecord = record(scoped);
  const source = Array.isArray(scoped)
    ? scoped
    : Array.isArray(scopedRecord?.data)
      ? scopedRecord.data
      : Array.isArray(scopedRecord?.dynamics)
        ? scopedRecord.dynamics
        : scoped;
  const candidates: readonly [unknown, unknown][] = Array.isArray(source)
    ? source.map((row) => [undefined, row] as const)
    : record(source)
      ? Object.entries(record(source)!)
      : [];
  if (
    candidates.length === 0 ||
    candidates.length > frequencySeasonalitySeriesPointLimit
  ) return undefined;
  const points = new Map<string, SeasonalityPoint>();
  for (const [dateKey, raw] of candidates) {
    const row = record(raw);
    const tuple = Array.isArray(raw) ? raw : undefined;
    const periodStart = seasonalityDate(
      row?.date ?? row?.period ?? row?.period_start ?? row?.start ?? tuple?.[0] ?? dateKey,
      granularity
    );
    const count = decimal(
      row?.value ?? row?.count ?? row?.shows ?? row?.frequency ?? row?.ws ?? tuple?.[1] ?? raw
    );
    const share = seasonalityShare(
      row?.share ?? row?.ratio ?? tuple?.[2]
    );
    if (!periodStart || !count || share === null) return undefined;
    if (periodStart < from || periodStart > through) continue;
    if (points.has(periodStart)) return undefined;
    points.set(periodStart, {
      periodStart,
      value: count,
      ...(share === undefined ? {} : { share })
    });
  }
  if (points.size === 0) return undefined;
  return [...points.values()].sort((left, right) =>
    left.periodStart.localeCompare(right.periodStart)
  );
}

function compatibleSeasonalityRange(
  providerFrom: unknown,
  providerThrough: unknown,
  requestedFrom: string,
  requestedThrough: string
): boolean {
  if (providerFrom === undefined && providerThrough === undefined) return true;
  const from = canonicalProviderDate(providerFrom);
  const through = canonicalProviderDate(providerThrough);
  return Boolean(
    from &&
    through &&
    from <= through &&
    from <= requestedThrough &&
    through >= requestedFrom
  );
}

function canonicalProviderDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

function seasonalityDate(
  value: unknown,
  granularity: FrequencySeasonalityGranularity
): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = /^\d{4}-\d{2}$/u.test(value)
    ? `${value}-01`
    : /^\d{2}\.\d{2}\.\d{4}$/u.test(value)
      ? `${value.slice(6)}-${value.slice(3, 5)}-${value.slice(0, 2)}`
      : value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return undefined;
  const date = new Date(`${candidate}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== candidate) return undefined;
  if (granularity === "MONTH" && date.getUTCDate() !== 1) return undefined;
  if (granularity === "WEEK" && date.getUTCDay() !== 1) return undefined;
  return candidate;
}

function seasonalityShare(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const candidate = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string" ? value : undefined;
  if (!candidate || !/^(?:0(?:\.\d{1,18})?|1(?:\.0{1,18})?)$/u.test(candidate)) {
    return null;
  }
  return candidate;
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
  const lifecycle = arsenkinTaskLifecycle(body?.status, body?.progress);
  if (
    body?.code !== "TASK_STATUS" ||
    (body.task_id !== undefined && taskIdFromUnknown(body.task_id) !== taskId) ||
    lifecycle === undefined
  ) return undefined;
  return lifecycle;
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

function arsenkinSeasonalityGroup(
  granularity: FrequencySeasonalityGranularity
): "month" | "week" | "day" {
  if (granularity === "MONTH") return "month";
  if (granularity === "WEEK") return "week";
  return "day";
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
