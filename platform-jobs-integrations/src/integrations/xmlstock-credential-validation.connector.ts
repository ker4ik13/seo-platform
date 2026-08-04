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

const XMLSTOCK_ACCOUNT_URL = "https://xmlstock.com/api/";
const XMLSTOCK_WORDSTAT_URL = "https://xmlstock.com/wordstat/json/";

export class XmlStockCredentialValidationConnector
  implements IntegrationCredentialValidationConnector
{
  public readonly provider = "XMLSTOCK" as const;
  public readonly version =
    XMLSTOCK_CREDENTIAL_VALIDATION_CONNECTOR_VERSION;

  public constructor(private readonly fetcher: ProviderFetch = fetch) {}

  public async validate(
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<CredentialValidationResult> {
    if (!secret.accountIdentifier) return invalidCredential();
    const accountUrl = authenticatedUrl(XMLSTOCK_ACCOUNT_URL, secret);
    const regionUrl = authenticatedUrl(XMLSTOCK_WORDSTAT_URL, secret);
    // XMLStock selects the response shape through `pagetype`. The legacy
    // `regionsTree=1` query is ignored by the current API and can therefore
    // make a valid credential look like an invalid provider response.
    regionUrl.searchParams.set("pagetype", "regionsTree");
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

      // Wordstat availability is useful capability metadata, but it must not
      // hide a valid account balance when the auxiliary region catalogue is
      // temporarily unavailable.
      try {
        const regions = await providerJsonRequest(
          regionUrl,
          { method: "GET", headers: { Accept: "application/json" } },
          timeoutMs,
          this.fetcher
        );
        const regionResult = xmlStockValidationResult(
          regions.status,
          regions.value
        );
        return regionResult.ok
          ? {
              ok: true,
              providerMeta: {
                ...accountResult.providerMeta,
                ...regionResult.providerMeta
              }
            }
          : accountResult;
      } catch (error) {
        if (error instanceof ProviderTransportError) return accountResult;
        throw error;
      }
    } catch (error) {
      if (error instanceof ProviderTransportError) return unavailable();
      throw error;
    }
  }
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

function authenticatedUrl(
  endpoint: string,
  secret: IntegrationCredentialSecret
): URL {
  const url = new URL(endpoint);
  url.searchParams.set("user", secret.accountIdentifier ?? "");
  url.searchParams.set("key", secret.apiKey);
  return url;
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
