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
  | {
      readonly ok: false;
      readonly code: string;
      readonly retryable: boolean;
      readonly retryAfterSeconds?: number;
    };

export class XmlStockWordstatConnector {
  public readonly version = "xmlstock-wordstat@1.0.0";

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
      const result = xmlStockWordstatResult(response.status, response.value);
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
  value: unknown
): WordstatCollectionResult {
  if (status === 401 || status === 403) return failure("INVALID_CREDENTIAL", false);
  if (status === 429) return failure("PROVIDER_RATE_LIMITED", true);
  if (status >= 500) return failure("PROVIDER_UNAVAILABLE", true);
  if (status < 200 || status >= 300) return failure("PROVIDER_REQUEST_REJECTED", false);
  const body = record(value);
  if (!body) return failure("PROVIDER_INVALID_RESPONSE", true);
  const error = providerError(body.error);
  if (error) {
    if (error === "-34" || error === "401" || error === "403") {
      return failure("INVALID_CREDENTIAL", false);
    }
    if (error === "55" || error === "429" || error === "503") {
      return failure("PROVIDER_RATE_LIMITED", true);
    }
    if (error === "101") return failure("PROVIDER_UNAVAILABLE", true);
    if (error === "200") return failure("PROVIDER_LOW_BALANCE", false);
    return failure("PROVIDER_REQUEST_REJECTED", false);
  }
  const count = decimal(body.totalCount ?? body.total_count);
  return count === undefined
    ? failure("PROVIDER_INVALID_RESPONSE", true)
    : { ok: true, value: count };
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
): WordstatCollectionResult {
  return { ok: false, code, retryable };
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
