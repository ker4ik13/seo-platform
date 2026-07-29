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

const ARSENKIN_LIMITS_URL = new URL(
  "https://arsenkin.ru/api/tools/info"
);

export class ArsenkinCredentialValidationConnector
  implements IntegrationCredentialValidationConnector
{
  public readonly provider = "ARSENKIN" as const;
  public readonly version = "arsenkin@1.0.0";

  public constructor(private readonly fetcher: ProviderFetch = fetch) {}

  public async validate(
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<CredentialValidationResult> {
    try {
      const response = await providerJsonRequest(
        ARSENKIN_LIMITS_URL,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${secret.apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ query: "limits" })
        },
        timeoutMs,
        this.fetcher
      );
      return withProviderRetryAfter(
        arsenkinResult(response.status, response.value),
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

export function arsenkinResult(
  status: number,
  value: unknown
): CredentialValidationResult {
  if (status === 401 || status === 403) return invalidCredential();
  if (status === 429) return rateLimited();
  if (status >= 500) return unavailable();
  if (status < 200 || status >= 300) return requestRejected();

  const body = record(value);
  if (!body) return unavailable();
  const providerStatus =
    typeof body.status === "string" ? body.status.toLowerCase() : undefined;
  const providerCode =
    typeof body.code === "string" || typeof body.code === "number"
      ? String(body.code)
      : undefined;
  if (providerStatus === "error" || body.error) {
    if (providerCode === "401" || providerCode === "403") {
      return invalidCredential();
    }
    if (providerCode === "429") return rateLimited();
    return requestRejected();
  }
  if (providerStatus !== "success") return unavailable();

  const limitsTotal = nonNegativeSafeNumber(body.limits_total);
  const limitsUsed = nonNegativeSafeNumber(
    body.limits_used ?? body.limits_spent
  );
  return {
    ok: true,
    ...(
      limitsTotal !== undefined || limitsUsed !== undefined
        ? {
            providerMeta: {
              ...(limitsTotal !== undefined ? { limitsTotal } : {}),
              ...(limitsUsed !== undefined ? { limitsUsed } : {})
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

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
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
