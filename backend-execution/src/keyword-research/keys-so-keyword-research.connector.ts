import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import {
  providerJsonRequest,
  ProviderTransportError
} from "../integrations/provider-json-request.js";

const ENDPOINT = "https://api.keys.so/report/simple/organic/keywords";
const PAGE_SIZE = 25;

export interface KeysSoKeywordRow {
  readonly providerRowId?: string;
  readonly keyword: string;
  readonly url?: string;
  readonly frequencyBase?: number;
  readonly frequencyExact?: number;
  readonly frequencyFixed?: number;
  readonly position?: number;
  readonly kei?: number;
}

export type KeysSoKeywordResearchResult =
  | {
      readonly ok: true;
      readonly rows: readonly KeysSoKeywordRow[];
      readonly totalAvailable?: number;
      readonly lastPage?: number;
      readonly raw: unknown;
    }
  | {
      readonly ok: false;
      readonly code:
        | "INVALID_CREDENTIAL"
        | "PROVIDER_RATE_LIMITED"
        | "DOMAIN_NOT_FOUND"
        | "PROVIDER_REQUEST_REJECTED"
        | "PROVIDER_UNAVAILABLE";
      readonly retryable: boolean;
      readonly retryAfterSeconds?: number;
    };

export class KeysSoKeywordResearchConnector {
  public constructor(private readonly fetcher: ProviderFetch = fetch) {}

  public async collect(
    input: {
      readonly domain: string;
      readonly database: string;
      readonly page: number;
    },
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<KeysSoKeywordResearchResult> {
    const url = new URL(ENDPOINT);
    url.searchParams.set("base", input.database);
    url.searchParams.set("domain", input.domain);
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("per_page", String(PAGE_SIZE));
    try {
      const response = await providerJsonRequest(
        url,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Keyso-TOKEN": secret.apiKey
          }
        },
        timeoutMs,
        this.fetcher
      );
      if (response.status === 401 || response.status === 403) {
        return failure("INVALID_CREDENTIAL", false);
      }
      if (response.status === 429) {
        return failure(
          "PROVIDER_RATE_LIMITED",
          true,
          response.retryAfterSeconds
        );
      }
      if (response.status === 404) {
        return failure("DOMAIN_NOT_FOUND", false);
      }
      if (response.status >= 500) {
        return failure(
          "PROVIDER_UNAVAILABLE",
          true,
          response.retryAfterSeconds
        );
      }
      if (response.status < 200 || response.status >= 300) {
        return failure("PROVIDER_REQUEST_REJECTED", false);
      }
      return success(response.value);
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return failure("PROVIDER_UNAVAILABLE", true);
      }
      throw error;
    }
  }
}

function success(value: unknown): KeysSoKeywordResearchResult {
  const body = record(value);
  if (!body || !Array.isArray(body.data) || body.data.length > PAGE_SIZE) {
    return failure("PROVIDER_UNAVAILABLE", true);
  }
  const rows: KeysSoKeywordRow[] = [];
  for (const valueRow of body.data) {
    const row = record(valueRow);
    const keyword = trimmed(row?.word, 2_000);
    if (!row || !keyword) return failure("PROVIDER_UNAVAILABLE", true);
    const url = trimmed(row.url, 8_192);
    const providerRowId = scalarId(row.id);
    const frequencyBase = nonNegativeInteger(row.ws);
    const frequencyExact = nonNegativeInteger(row.wsk);
    const frequencyFixed = nonNegativeInteger(row.superwsk);
    const position = positiveInteger(row.pos);
    const kei = nonNegativeNumber(row.kei);
    rows.push({
      ...(providerRowId === undefined ? {} : { providerRowId }),
      keyword,
      ...(url ? { url } : {}),
      ...(frequencyBase === undefined ? {} : { frequencyBase }),
      ...(frequencyExact === undefined ? {} : { frequencyExact }),
      ...(frequencyFixed === undefined ? {} : { frequencyFixed }),
      ...(position === undefined ? {} : { position }),
      ...(kei === undefined ? {} : { kei })
    });
  }
  const totalAvailable = nonNegativeInteger(body.total);
  const lastPage = positiveInteger(body.last_page);
  return {
    ok: true,
    rows,
    ...(totalAvailable === undefined ? {} : { totalAvailable }),
    ...(lastPage === undefined ? {} : { lastPage }),
    raw: value
  };
}

function failure(
  code: Exclude<KeysSoKeywordResearchResult, { readonly ok: true }>["code"],
  retryable: boolean,
  retryAfterSeconds?: number
): KeysSoKeywordResearchResult {
  return {
    ok: false,
    code,
    retryable,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
  };
}

function record(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function trimmed(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : undefined;
}

function scalarId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value);
  return normalized.length <= 128 ? normalized : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number =
    typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) &&
    Number(number) >= 0 &&
    Number(number) <= 2_147_483_647
    ? Number(number)
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = nonNegativeInteger(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const number =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" &&
    Number.isFinite(number) &&
    number >= 0 &&
    number <= Number.MAX_SAFE_INTEGER
    ? number
    : undefined;
}
