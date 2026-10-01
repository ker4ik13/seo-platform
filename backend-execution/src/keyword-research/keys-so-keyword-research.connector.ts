import type { IntegrationCredentialSecret } from "../integrations/integration-credential-crypto.service.js";
import type {
  KeysSoCompetitor,
  KeysSoDomainOverview
} from "@seo-platform/contracts";
import type { ProviderFetch } from "../integrations/integration-credential-validation.connector.js";
import { ProviderCapacityUnavailableError } from "../integrations/provider-execution-review.js";
import {
  providerJsonRequest,
  ProviderTransportError
} from "../integrations/provider-json-request.js";

const ENDPOINT = "https://api.keys.so/report/simple/organic/keywords";
const DASHBOARD_ENDPOINT = "https://api.keys.so/report/simple/domain_dashboard";
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

type KeysSoFailure = {
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

export type KeysSoKeywordResearchResult =
  | {
      readonly ok: true;
      readonly rows: readonly KeysSoKeywordRow[];
      readonly totalAvailable?: number;
      readonly lastPage?: number;
      readonly raw: unknown;
    }
  | KeysSoFailure;

export type KeysSoDomainInspectionResult =
  | {
      readonly ok: true;
      readonly overview: KeysSoDomainOverview;
      readonly competitors: readonly KeysSoCompetitor[];
      readonly totalAvailable?: number;
      readonly raw: unknown;
    }
  | KeysSoFailure;

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
      const failed = responseFailure(response.status, response.retryAfterSeconds);
      if (failed) return failed;
      return success(response.value);
    } catch (error) {
      if(error instanceof ProviderCapacityUnavailableError) return {ok:false,code:"PROVIDER_RATE_LIMITED",retryable:true,retryAfterSeconds:1};
      if (error instanceof ProviderTransportError) {
        return failure("PROVIDER_UNAVAILABLE", true);
      }
      throw error;
    }
  }

  public async inspectDomain(
    input: { readonly domain: string; readonly database: string },
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<KeysSoDomainInspectionResult> {
    const url = new URL(DASHBOARD_ENDPOINT);
    url.searchParams.set("base", input.database);
    url.searchParams.set("domain", input.domain);
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
      const failed = responseFailure(response.status, response.retryAfterSeconds);
      return failed ?? inspection(response.value);
    } catch (error) {
      if(error instanceof ProviderCapacityUnavailableError) return {ok:false,code:"PROVIDER_RATE_LIMITED",retryable:true,retryAfterSeconds:1};
      if (error instanceof ProviderTransportError) {
        return failure("PROVIDER_UNAVAILABLE", true);
      }
      throw error;
    }
  }
}

function responseFailure(
  status: number,
  retryAfterSeconds?: number
): KeysSoFailure | undefined {
  if (status === 202) return failure("PROVIDER_UNAVAILABLE", true, retryAfterSeconds ?? 5);
  if (status === 401 || status === 403) return failure("INVALID_CREDENTIAL", false);
  if (status === 429) return failure("PROVIDER_RATE_LIMITED", true, retryAfterSeconds);
  if (status === 404) return failure("DOMAIN_NOT_FOUND", false);
  if (status >= 500) return failure("PROVIDER_UNAVAILABLE", true, retryAfterSeconds);
  if (status < 200 || status >= 300) return failure("PROVIDER_REQUEST_REJECTED", false);
  return undefined;
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

function inspection(value: unknown): KeysSoDomainInspectionResult {
  const root = record(value);
  const body = record(root?.data) ?? root;
  if (!body) return failure("PROVIDER_UNAVAILABLE", true);
  const top1 = nonNegativeInteger(body.it1);
  const top3 = nonNegativeInteger(body.it3);
  const top5 = nonNegativeInteger(body.it5);
  const top10 = nonNegativeInteger(body.it10);
  const top50 = nonNegativeInteger(body.it50);
  if ([top1, top3, top5, top10, top50].some((item) => item === undefined)) {
    return failure("PROVIDER_UNAVAILABLE", true);
  }
  const visibility = nonNegativeNumber(body.vis);
  const pagesInIndex = nonNegativeInteger(body.pagesinindex);
  const aiAnswers = nonNegativeInteger(body.aiAnswersCnt);
  const totalAvailable = nonNegativeInteger(body.keys);
  const competitors = Array.isArray(body.concs)
    ? body.concs.slice(0, 100).flatMap((item) => {
        const row = record(item);
        const domain = trimmed(row?.name ?? row?.domain, 253);
        const commonKeywords = nonNegativeInteger(row?.cnt ?? row?.keys);
        if (!domain || commonKeywords === undefined) return [];
        const similarity = nonNegativeNumber(row?.perc);
        const thematicity = nonNegativeNumber(row?.theme);
        const competitorTop10 = nonNegativeInteger(row?.it10);
        const competitorTop50 = nonNegativeInteger(row?.it50);
        const competitorVisibility = nonNegativeNumber(row?.vis);
        return [{
          domain,
          commonKeywords,
          ...(similarity === undefined ? {} : { similarity }),
          ...(thematicity === undefined ? {} : { thematicity }),
          ...(competitorTop10 === undefined ? {} : { top10: competitorTop10 }),
          ...(competitorTop50 === undefined ? {} : { top50: competitorTop50 }),
          ...(competitorVisibility === undefined ? {} : { visibility: competitorVisibility })
        } satisfies KeysSoCompetitor];
      })
    : [];
  return {
    ok: true,
    overview: {
      top1: top1 as number,
      top3: top3 as number,
      top5: top5 as number,
      top10: top10 as number,
      top50: top50 as number,
      ...(visibility === undefined ? {} : { visibility }),
      ...(pagesInIndex === undefined ? {} : { pagesInIndex }),
      ...(aiAnswers === undefined ? {} : { aiAnswers })
    },
    competitors,
    ...(totalAvailable === undefined ? {} : { totalAvailable }),
    raw: value
  };
}

function failure(
  code: KeysSoFailure["code"],
  retryable: boolean,
  retryAfterSeconds?: number
): KeysSoFailure {
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
