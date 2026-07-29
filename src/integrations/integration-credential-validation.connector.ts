import type {
  IntegrationCredentialStatus,
  IntegrationProvider
} from "@seo-platform/contracts";
import type { IntegrationCredentialSecret } from "./integration-credential-crypto.service.js";

export interface CredentialValidationSuccess {
  readonly ok: true;
  readonly providerMeta?: Readonly<Record<string, unknown>>;
}

export interface CredentialValidationFailure {
  readonly ok: false;
  readonly errorCode: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly credentialStatus: Extract<
    IntegrationCredentialStatus,
    "INVALID" | "RATE_LIMITED" | "DEGRADED"
  >;
}

export type CredentialValidationResult =
  | CredentialValidationSuccess
  | CredentialValidationFailure;

export interface IntegrationCredentialValidationConnector {
  readonly provider: IntegrationProvider;
  readonly version: string;
  validate(
    secret: IntegrationCredentialSecret,
    timeoutMs: number
  ): Promise<CredentialValidationResult>;
}

export type ProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export function withProviderRetryAfter(
  result: CredentialValidationResult,
  retryAfterSeconds: number | undefined
): CredentialValidationResult {
  if (
    result.ok ||
    !result.retryable ||
    typeof retryAfterSeconds !== "number" ||
    !Number.isSafeInteger(retryAfterSeconds) ||
    retryAfterSeconds < 0
  ) {
    return result;
  }
  return {
    ...result,
    retryAfterSeconds: Math.min(retryAfterSeconds, 3_600)
  };
}
