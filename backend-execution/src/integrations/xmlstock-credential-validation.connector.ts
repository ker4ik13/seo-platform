import {
  type CredentialValidationResult,
  type IntegrationCredentialValidationConnector,
  type ProviderFetch,
  withProviderRetryAfter
} from "./integration-credential-validation.connector.js";
import { XMLSTOCK_CREDENTIAL_VALIDATION_CONNECTOR_VERSION } from "./integration-credential-connector-versions.js";
import type { IntegrationCredentialSecret } from "./integration-credential-crypto.service.js";
import {
  providerJsonRequest,
  ProviderTransportError
} from "./provider-json-request.js";
import { xmlStockPricingMetadata } from "./xmlstock-pricing.js";
import { xmlStockAuthenticatedUrl } from "./xmlstock-request-url.js";

const XMLSTOCK_ACCOUNT_URL = "https://xmlstock.com/api/";

export class XmlStockCredentialValidationConnector
  implements IntegrationCredentialValidationConnector
{
  public readonly provider = "XMLSTOCK" as const;
  public readonly version =
    XMLSTOCK_CREDENTIAL_VALIDATION_CONNECTOR_VERSION;

  public constructor(
    private readonly fetcher: ProviderFetch = fetch,
    private readonly softId?: string
  ) {}

  public async validate(
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<CredentialValidationResult> {
    if (!secret.accountIdentifier) return invalidCredential();
    const accountUrl = xmlStockAuthenticatedUrl(XMLSTOCK_ACCOUNT_URL, secret, this.softId);
    const userInfoUrl = xmlStockAuthenticatedUrl(XMLSTOCK_ACCOUNT_URL, secret, this.softId);
    const statusInfoUrl = xmlStockAuthenticatedUrl(XMLSTOCK_ACCOUNT_URL, secret, this.softId);
    userInfoUrl.searchParams.set("info", "user");
    statusInfoUrl.searchParams.set("info", "status");
    try {
      const account = await providerJsonRequest(
        accountUrl,
        { method: "GET", headers: { Accept: "application/json" } },
        timeoutMs,
        this.fetcher
      );
      const accountResult = withProviderRetryAfter(
        xmlStockAccountValidationResult(account.status, account.value),
        account.retryAfterSeconds
      );
      if (!accountResult.ok) return accountResult;

      const providerMeta: Record<string, unknown> = {
        ...accountResult.providerMeta
      };
      for (const [url, parser] of [
        [userInfoUrl, xmlStockUserInfoValidationResult],
        [statusInfoUrl, xmlStockStatusInfoValidationResult]
      ] as const) {
        try {
          const response = await providerJsonRequest(
            url,
            { method: "GET", headers: { Accept: "application/json" } },
            timeoutMs,
            this.fetcher
          );
          const result = parser(response.status, response.value);
          if (result.ok && result.providerMeta) {
            Object.assign(providerMeta, result.providerMeta);
          }
        } catch (error) {
          if (!(error instanceof ProviderTransportError)) throw error;
        }
      }

      // Account, info=user and info=status are read-only account endpoints.
      // Validation must never issue a search/Wordstat request that can consume
      // provider balance merely to keep a credential fresh.
      return { ok: true, providerMeta };
    } catch (error) {
      if (error instanceof ProviderTransportError) return unavailable();
      throw error;
    }
  }
}

export function xmlStockUserInfoValidationResult(
  status: number,
  value: unknown
): CredentialValidationResult {
  const failure = xmlStockMetadataFailure(status, value);
  if (failure) return failure;
  const pricing = xmlStockPricingMetadata(value);
  return pricing
    ? { ok: true, providerMeta: { xmlStockPricing: pricing } }
    : unavailable();
}

export function xmlStockStatusInfoValidationResult(
  status: number,
  value: unknown
): CredentialValidationResult {
  const failure = xmlStockMetadataFailure(status, value);
  if (failure) return failure;
  const body = record(value);
  if (!body) return unavailable();
  const availableRequests = {
    GOOGLE_LIVE: providerInteger(body["google-queries"]),
    YANDEX_LIVE: providerInteger(body["yandex-live-queries"]),
    YANDEX_TURBO: providerInteger(body["yandex-live-turbo-queries"]),
    YANDEX_SEARCH_API: providerInteger(body["yandex-xml-queries"])
  };
  const loadPercent = {
    GOOGLE_LIVE: providerInteger(body["google-load"]),
    YANDEX_LIVE: providerInteger(body["yandex-live-load"])
  };
  if (
    Object.values(availableRequests).some((item) => item === undefined) ||
    Object.values(loadPercent).some(
      (item) => item === undefined || item < 0 || item > 100
    )
  ) {
    return unavailable();
  }
  return {
    ok: true,
    providerMeta: {
      xmlStockStatus: {
        availableRequests,
        loadPercent
      }
    }
  };
}

function xmlStockMetadataFailure(
  status: number,
  value: unknown
): CredentialValidationResult | undefined {
  if (status === 401 || status === 403) return invalidCredential();
  if (status === 429) return rateLimited();
  if (status >= 500) return unavailable();
  if (status < 200 || status >= 300) return requestRejected();
  const error = providerError(record(value)?.error);
  if (!error) return undefined;
  if (error === "-34" || error === "401" || error === "403") {
    return invalidCredential();
  }
  return requestRejected();
}

export function xmlStockAccountValidationResult(
  status: number,
  value: unknown
): CredentialValidationResult {
  if (status === 401 || status === 403) return invalidCredential();
  if (status === 429) return rateLimited();
  if (status >= 500) return unavailable();
  if (status < 200 || status >= 300) return requestRejected();
  const body = record(value);
  if (!body) return unavailable();
  const error = providerError(body.error);
  if (error) {
    if (error === "-34" || error === "401" || error === "403") {
      return invalidCredential();
    }
    return requestRejected();
  }
  const requestLimit = providerInteger(body.limits);
  const frozenRequestLimit = providerInteger(body["limits-freeze"]);
  const usedMonth = providerInteger(body["outgo-month"]);
  const usedToday = providerInteger(body["outgo-day"]);
  const balance = providerMoney(body.balance);
  const frozenBalance = providerMoney(body["balance-freeze"]);
  const tariffDaysRemaining = providerInteger(body.days);
  if (
    requestLimit === undefined ||
    usedMonth === undefined ||
    usedToday === undefined ||
    balance === undefined
  ) {
    return unavailable();
  }
  return {
    ok: true,
    providerMeta: {
      account: {
        requestLimit,
        frozenRequestLimit: frozenRequestLimit ?? 0,
        usedMonth,
        usedToday,
        balance,
        frozenBalance: frozenBalance ?? "0",
        tariffDaysRemaining: tariffDaysRemaining ?? 0
      }
    }
  };
}

export function xmlStockValidationResult(
  status: number,
  value: unknown
): CredentialValidationResult {
  if (status === 401 || status === 403) return invalidCredential();
  if (status === 429) return rateLimited();
  if (status >= 500) return unavailable();
  if (status < 200 || status >= 300) return requestRejected();

  const body = record(value);
  if (!body) return unavailable();
  const error = providerError(body.error);
  if (error) {
    if (error === "-34" || error === "401" || error === "403") {
      return invalidCredential();
    }
    if (
      error === "32" ||
      error === "55" ||
      error === "429" ||
      error === "503"
    ) {
      return rateLimited();
    }
    if (error === "20" || error === "101" || error === "300") {
      return unavailable();
    }
    return requestRejected();
  }
  const regions = body.regionsTree ?? body.regions;
  if (!Array.isArray(regions) && !record(regions)) return unavailable();
  return {
    ok: true,
    providerMeta: {
      wordstat: true,
      regionCatalogAvailable: true
    }
  };
}

function providerError(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  const error = record(value);
  const code = error?.code ?? error?.status;
  return typeof code === "number" || typeof code === "string"
    ? String(code)
    : undefined;
}

function invalidCredential(): CredentialValidationResult {
  return {
    ok: false,
    errorCode: "INVALID_CREDENTIAL",
    retryable: false,
    credentialStatus: "INVALID"
  };
}

function rateLimited(): CredentialValidationResult {
  return {
    ok: false,
    errorCode: "PROVIDER_RATE_LIMITED",
    retryable: true,
    credentialStatus: "RATE_LIMITED"
  };
}

function unavailable(): CredentialValidationResult {
  return {
    ok: false,
    errorCode: "PROVIDER_UNAVAILABLE",
    retryable: true,
    credentialStatus: "DEGRADED"
  };
}

function requestRejected(): CredentialValidationResult {
  return {
    ok: false,
    errorCode: "PROVIDER_PLAN_OR_REQUEST_REJECTED",
    retryable: false,
    credentialStatus: "DEGRADED"
  };
}

function record(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function providerInteger(value: unknown): number | undefined {
  const parsed = typeof value === "string" && /^\d+$/u.test(value)
    ? Number(value)
    : value;
  return Number.isSafeInteger(parsed) && Number(parsed) >= 0
    ? Number(parsed)
    : undefined;
}

function providerMoney(value: unknown): string | undefined {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^\d+(?:\.\d{1,8})?$/u.test(String(value))
  ) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? String(value) : undefined;
}
