import {
  withProviderRetryAfter,
  type CredentialValidationResult,
  type IntegrationCredentialValidationConnector,
  type ProviderFetch
} from "./integration-credential-validation.connector.js";
import type { IntegrationCredentialSecret } from "./integration-credential-crypto.service.js";
import {
  providerJsonRequest,
  ProviderTransportError
} from "./provider-json-request.js";

const KEYS_SO_LIMITS_URL = new URL("https://api.keys.so/limits/all");

export class KeysSoCredentialValidationConnector
  implements IntegrationCredentialValidationConnector
{
  public readonly provider = "KEYS_SO" as const;
  public readonly version = "keys-so@1.0.0";

  public constructor(private readonly fetcher: ProviderFetch = fetch) {}

  public async validate(
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<CredentialValidationResult> {
    try {
      const response = await providerJsonRequest(
        KEYS_SO_LIMITS_URL,
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
      return withProviderRetryAfter(
        keysSoResult(response.status, response.value),
        response.retryAfterSeconds
      );
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        return unavailable();
      }
      throw error;
    }
  }
}

export function keysSoResult(
  status: number,
  value: unknown
): CredentialValidationResult {
  if (status === 401 || status === 403) return invalidCredential();
  if (status === 429) return rateLimited();
  if (status >= 500) return unavailable();
  if (status < 200 || status >= 300) return requestRejected();

  const body = record(value);
  if (!body) return unavailable();
  const providerError = record(body.error);
  if (body.error !== undefined) {
    const providerCode =
      providerError?.code ?? body.code ?? providerError?.status;
    if (
      providerCode === 401 ||
      providerCode === "401" ||
      providerCode === 403 ||
      providerCode === "403"
    ) {
      return invalidCredential();
    }
    if (providerCode === 429 || providerCode === "429") {
      return rateLimited();
    }
    return requestRejected();
  }
  const apiRequest = record(body.apiRequest);
  if (!apiRequest) return unavailable();
  const limit = nonNegativeSafeNumber(apiRequest.limit);
  const usedLimit = nonNegativeSafeNumber(apiRequest.usedLimit);
  return {
    ok: true,
    ...(
      limit !== undefined || usedLimit !== undefined
        ? {
            providerMeta: {
              apiRequest: {
                ...(limit !== undefined ? { limit } : {}),
                ...(usedLimit !== undefined ? { usedLimit } : {})
              }
            }
          }
        : {}
    )
  };
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

function nonNegativeSafeNumber(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : undefined;
}
