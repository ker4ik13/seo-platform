import type {
  SemanticFrequencyDevice,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import {
  providerJsonRequest,
  ProviderTransportError
} from "../integrations/provider-json-request.js";

const XMLSTOCK_WORDSTAT_URL = "https://xmlstock.com/wordstat/json/";

export type WordstatCollectionResult =
  | { readonly ok: true; readonly value: string }
  | ProviderFailure;

type ProviderFailure = {
  readonly ok: false;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
};

export interface XmlStockWordstatExpansionRow {
  readonly keyword: string;
  readonly frequencyBase: number;
  readonly sourceQuery: string;
  readonly sourceColumn: "LEFT" | "RIGHT";
}

export type XmlStockWordstatExpansionResult =
  | {
      readonly ok: true;
      readonly rows: readonly XmlStockWordstatExpansionRow[];
      readonly raw: unknown;
    }
  | ProviderFailure;

export class XmlStockWordstatConnector {
  public readonly version = "xmlstock-wordstat@1.3.0";

  public constructor(private readonly fetcher: ProviderFetch = fetch) {}

  public async collect(
    input: {
      readonly keyword: string;
      readonly type: SemanticFrequencyType;
      readonly regionCode: string;
      readonly device: SemanticFrequencyDevice;
    },
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<WordstatCollectionResult> {
    if (!secret.accountIdentifier) return failure("INVALID_CREDENTIAL", false);
    const url = new URL(XMLSTOCK_WORDSTAT_URL);
    url.searchParams.set("user", secret.accountIdentifier);
    url.searchParams.set("key", secret.apiKey);
    url.searchParams.set("query", wordstatQuery(input.keyword, input.type));
    url.searchParams.set("pagetype", "words");
    // XMLStock returns an exact aggregate row for operator queries only when
    // grouping is requested. Live responses can omit `totalCount` in that
    // shape, so the parser below also verifies the matching result row.
    url.searchParams.set("groupby", "1");
    url.searchParams.set(
      "regions",
      input.regionCode === "ALL" ? "all" : input.regionCode
    );
    url.searchParams.set("device", providerDevice(input.device));
    try {
      const response = await providerJsonRequest(
        url,
        { method: "GET", headers: { Accept: "application/json" } },
        timeoutMs,
        this.fetcher
      );
      const result = xmlStockWordstatResult(
        response.status,
        response.value,
        input.keyword
      );
      return !result.ok && result.retryable && response.retryAfterSeconds !== undefined
        ? { ...result, retryAfterSeconds: response.retryAfterSeconds }
        : result;
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return failure("PROVIDER_UNAVAILABLE", true);
      }
      throw error;
    }
  }

  public async expand(
    input: {
      readonly query: string;
      readonly regionCode: string;
      readonly device: SemanticFrequencyDevice;
      readonly minusWords: readonly string[];
      readonly clearMinusPhrases: boolean;
      readonly includeRightColumn: boolean;
      readonly clearPlus: boolean;
      readonly maxKeywords: number;
    },
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<XmlStockWordstatExpansionResult> {
    if (!secret.accountIdentifier) return failure("INVALID_CREDENTIAL", false);
    let query: string;
    try {
      query = expansionQuery(input);
    } catch (error) {
      if (error instanceof WordstatQueryError) {
        return failure("PROVIDER_REQUEST_REJECTED", false);
      }
      throw error;
    }
    const url = new URL(XMLSTOCK_WORDSTAT_URL);
    url.searchParams.set("user", secret.accountIdentifier);
    url.searchParams.set("key", secret.apiKey);
    url.searchParams.set("query", query);
    url.searchParams.set("pagetype", "words");
    url.searchParams.set("groupby", String(Math.min(2_000, input.maxKeywords)));
    url.searchParams.set("regions", input.regionCode);
    url.searchParams.set("device", providerDevice(input.device));
    try {
      const response = await providerJsonRequest(
        url,
        { method: "GET", headers: { Accept: "application/json" } },
        timeoutMs,
        this.fetcher
      );
      const result = xmlStockWordstatExpansionResult(
        response.status,
        response.value,
        input.query,
        input.includeRightColumn,
        input.maxKeywords
      );
      return !result.ok && result.retryable && response.retryAfterSeconds !== undefined
        ? { ...result, retryAfterSeconds: response.retryAfterSeconds }
        : result;
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return failure("PROVIDER_UNAVAILABLE", true);
      }
      throw error;
    }
  }
}

export function xmlStockWordstatExpansionResult(
  status: number,
  value: unknown,
  sourceQuery: string,
  includeRightColumn: boolean,
  maxKeywords: number
): XmlStockWordstatExpansionResult {
  const requestFailure = providerRequestFailure(status, value);
  if (requestFailure) return requestFailure;
  if (!Number.isSafeInteger(maxKeywords) || maxKeywords < 1 || maxKeywords > 10_000) {
    return failure("PROVIDER_INVALID_RESPONSE", true);
  }
  const body = record(value);
  if (!body || !Array.isArray(body.results)) {
    return failure("PROVIDER_INVALID_RESPONSE", true);
  }
  if (includeRightColumn && !Array.isArray(body.associations)) {
    return failure("PROVIDER_INVALID_RESPONSE", true);
  }
  const normalizedSource = normalizedDisplayPhrase(sourceQuery);
  if (!normalizedSource) return failure("PROVIDER_INVALID_RESPONSE", true);
  const output = new Map<string, XmlStockWordstatExpansionRow>();
  const totalCount = providerCount(body.totalCount ?? body.total_count);
  if (totalCount !== undefined) {
    addExpansionRow(output, normalizedSource, totalCount, normalizedSource, "LEFT", maxKeywords);
  }
  if (!appendExpansionRows(output, body.results, normalizedSource, "LEFT", maxKeywords)) {
    return failure("PROVIDER_INVALID_RESPONSE", true);
  }
  if (
    includeRightColumn &&
    !appendExpansionRows(
      output,
      body.associations as readonly unknown[],
      normalizedSource,
      "RIGHT",
      maxKeywords
    )
  ) {
    return failure("PROVIDER_INVALID_RESPONSE", true);
  }
  return { ok: true, rows: [...output.values()], raw: value };
}

export function wordstatQuery(
  keyword: string,
  type: SemanticFrequencyType
): string {
  const normalized = keyword.trim().replace(/\s+/gu, " ");
  const words = normalized.split(" ");
  if (
    !normalized ||
    normalized.length > 400 ||
    words.length > 40 ||
    hasControlCharacter(normalized)
  ) {
    throw new WordstatQueryError();
  }
  if (type === "BASE") return normalized;
  if (type === "EXACT") {
    return validQuery(`"${normalized.replaceAll('"', "")}"`);
  }
  const fixed = words
    .map((word) => word.replace(/^!+/u, ""))
    .filter(Boolean)
    .map((word) => `!${word}`)
    .join(" ");
  if (!fixed) throw new WordstatQueryError();
  return validQuery(`"${fixed.replaceAll('"', "")}"`);
}

function validQuery(value: string): string {
  if (value.length > 400) throw new WordstatQueryError();
  return value;
}

export function xmlStockWordstatResult(
  status: number,
  value: unknown,
  keyword?: string
): WordstatCollectionResult {
  const requestFailure = providerRequestFailure(status, value);
  if (requestFailure) return requestFailure;
  const body = record(value);
  if (!body) return failure("PROVIDER_INVALID_RESPONSE", true);
  const count = decimal(body.totalCount ?? body.total_count);
  if (count !== undefined) return { ok: true, value: count };

  const results = body.results;
  if (!Array.isArray(results)) {
    return failure("PROVIDER_INVALID_RESPONSE", true);
  }
  if (results.length === 0) return { ok: true, value: "0" };
  // With groupby=1 XMLStock returns the aggregate operator result as the only
  // row, but Yandex can normalize its displayed phrase (for example change a
  // grammatical form). The count is still the result for the submitted query.
  // Requiring the display phrase to equal the source keyword therefore turns
  // a successful provider response into a false PROVIDER_INVALID_RESPONSE.
  if (results.length === 1) {
    const onlyRow = record(results[0]);
    const onlyCount = decimal(onlyRow?.count);
    return onlyCount === undefined
      ? failure("PROVIDER_INVALID_RESPONSE", true)
      : { ok: true, value: onlyCount };
  }
  const expectedPhrase = normalizedPhrase(keyword);
  if (!expectedPhrase) return failure("PROVIDER_INVALID_RESPONSE", true);
  for (const candidate of results) {
    const row = record(candidate);
    if (
      normalizedPhrase(row?.phrase) === expectedPhrase
    ) {
      const rowCount = decimal(row?.count);
      return rowCount === undefined
        ? failure("PROVIDER_INVALID_RESPONSE", true)
        : { ok: true, value: rowCount };
    }
  }
  return failure("PROVIDER_INVALID_RESPONSE", true);
}

function expansionQuery(input: {
  readonly query: string;
  readonly minusWords: readonly string[];
  readonly clearMinusPhrases: boolean;
  readonly clearPlus: boolean;
}): string {
  let query = input.query.trim().replace(/\s+/gu, " ");
  if (input.clearMinusPhrases) {
    query = query.replace(/(^|\s)-(?:"[^"]+"|\S+)/gu, "$1").replace(/\s+/gu, " ").trim();
  }
  if (input.clearPlus) query = query.replaceAll("+", "");
  query = wordstatQuery(query, "BASE");
  for (const item of input.minusWords) {
    const phrase = item.trim().replace(/\s+/gu, " ").replaceAll('"', "");
    if (!phrase) continue;
    query += phrase.includes(" ") ? ` -"${phrase}"` : ` -${phrase}`;
  }
  return validQuery(query);
}

function appendExpansionRows(
  output: Map<string, XmlStockWordstatExpansionRow>,
  rows: readonly unknown[],
  sourceQuery: string,
  sourceColumn: "LEFT" | "RIGHT",
  maxKeywords: number
): boolean {
  for (const candidate of rows) {
    const row = record(candidate);
    const phrase = normalizedDisplayPhrase(row?.phrase);
    const count = providerCount(row?.count);
    if (!phrase || count === undefined) return false;
    addExpansionRow(output, phrase, count, sourceQuery, sourceColumn, maxKeywords);
  }
  return true;
}

function addExpansionRow(
  output: Map<string, XmlStockWordstatExpansionRow>,
  keyword: string,
  frequencyBase: number,
  sourceQuery: string,
  sourceColumn: "LEFT" | "RIGHT",
  maxKeywords: number
): void {
  const key = keyword.toLocaleLowerCase("ru-RU");
  const current = output.get(key);
  if (current) {
    if (frequencyBase > current.frequencyBase) output.set(key, { ...current, frequencyBase });
    return;
  }
  if (output.size < maxKeywords) {
    output.set(key, { keyword, frequencyBase, sourceQuery, sourceColumn });
  }
}

function providerRequestFailure(
  status: number,
  value: unknown
): ProviderFailure | undefined {
  if (status === 401 || status === 403) return failure("INVALID_CREDENTIAL", false);
  if (status === 429 || status === 503) return failure("PROVIDER_RATE_LIMITED", true);
  if (status >= 500) return failure("PROVIDER_UNAVAILABLE", true);
  if (status < 200 || status >= 300) return failure("PROVIDER_REQUEST_REJECTED", false);
  const error = providerError(record(value)?.error);
  if (!error) return undefined;
  if (error === "-34" || error === "401" || error === "403") {
    return failure("INVALID_CREDENTIAL", false);
  }
  if (["32", "55", "110", "429", "503"].includes(error)) {
    return failure("PROVIDER_RATE_LIMITED", true);
  }
  if (["20", "101", "300"].includes(error)) {
    return failure("PROVIDER_UNAVAILABLE", true);
  }
  if (error === "200") return failure("PROVIDER_LOW_BALANCE", false);
  return failure("PROVIDER_REQUEST_REJECTED", false);
}

function providerCount(value: unknown): number | undefined {
  const parsed = decimal(value);
  if (parsed === undefined) return undefined;
  const count = Number(parsed);
  return Number.isSafeInteger(count) && count >= 0 && count <= 2_147_483_647
    ? count
    : undefined;
}

function normalizedDisplayPhrase(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length >= 1 && normalized.length <= 2_000 && !hasControlCharacter(normalized)
    ? normalized
    : undefined;
}

export class WordstatQueryError extends Error {
  public constructor() {
    super("Keyword cannot be represented as a Wordstat query");
    this.name = "WordstatQueryError";
  }
}

function providerDevice(value: SemanticFrequencyDevice): string {
  switch (value) {
    case "ALL": return "all";
    case "DESKTOP": return "desktop";
    case "MOBILE": return "mobile";
    case "PHONE_ONLY": return "phone";
    case "TABLET_ONLY": return "tablet";
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

function decimal(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9]\d{0,18})$/u.test(value)) {
    return value;
  }
  return undefined;
}

function normalizedPhrase(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru");
  return normalized || undefined;
}

function providerError(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "string") return String(value);
  const input = record(value);
  const code = input?.code ?? input?.status;
  return typeof code === "number" || typeof code === "string"
    ? String(code)
    : undefined;
}

function failure(
  code: string,
  retryable: boolean
): ProviderFailure {
  return { ok: false, code, retryable };
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
