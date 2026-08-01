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
    const url = new URL(XMLSTOCK_WORDSTAT_URL);
    url.searchParams.set("user", secret.accountIdentifier);
    url.searchParams.set("key", secret.apiKey);
    url.searchParams.set("regionsTree", "1");
    try {
      const response = await providerJsonRequest(
        url,
        { method: "GET", headers: { Accept: "application/json" } },
        timeoutMs,
        this.fetcher
      );
      return withProviderRetryAfter(
        xmlStockValidationResult(response.status, response.value),
        response.retryAfterSeconds
      );
    } catch (error) {
      if (error instanceof ProviderTransportError) return unavailable();
      throw error;
    }
  }
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
    if (error === "55" || error === "429" || error === "503") {
      return rateLimited();
    }
    if (error === "101") return unavailable();
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
