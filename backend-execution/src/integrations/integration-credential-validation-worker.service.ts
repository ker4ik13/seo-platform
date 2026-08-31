import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  IntegrationCredentialStatus,
  IntegrationCredentialValidationSummary,
  IntegrationProvider
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import { selectIntegrationCredentialSecret } from "./platform-credential-pool.js";
import {
  IntegrationCredentialExecutionBrokerService,
  type CredentialValidationClaim
} from "./integration-credential-execution-broker.service.js";
import type {
  CredentialValidationResult
} from "./integration-credential-validation.connector.js";

interface BrokerProviderFailure {
  readonly errorCode:
    | "INVALID_CREDENTIAL"
    | "PROVIDER_RATE_LIMITED"
    | "PROVIDER_UNAVAILABLE"
    | "PROVIDER_PLAN_OR_REQUEST_REJECTED";
  readonly credentialStatus?: Extract<
    IntegrationCredentialStatus,
    "INVALID" | "RATE_LIMITED" | "DEGRADED"
  >;
  readonly retryAfterSeconds?: number;
}

const PROVIDER_FINISH_SAFETY_MS = 2_000;

@Injectable()
export class IntegrationCredentialValidationWorkerService {
  public constructor(
    private readonly broker: IntegrationCredentialExecutionBrokerService,
    private readonly crypto: IntegrationCredentialCryptoService,
    private readonly connectors: IntegrationCredentialConnectorRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async process(
    validationId: string,
    leaseOwner: string
  ): Promise<IntegrationCredentialValidationSummary> {
    assertLeaseOwner(leaseOwner);
    const claim = await this.broker.claimValidation(
      validationId,
      leaseOwner,
      this.config.integrationCredentialValidation.leaseSeconds
    );
    if (!claim) throw validationNotFound();
    if (claim.outcome !== "CLAIMED") return claim.summary;

    if (claim.scopeState === "STALE") {
      return this.broker.finishJobFailure(
        claim,
        "CREDENTIAL_CHANGED"
      );
    }
    if (claim.scopeState === "DISABLED") {
      return this.broker.finishJobFailure(
        claim,
        "CREDENTIAL_DISABLED"
      );
    }
    if (claim.scopeState === "MODE_UNSUPPORTED") {
      return this.broker.finishJobFailure(
        claim,
        "CREDENTIAL_MODE_UNSUPPORTED"
      );
    }
    if (claim.scopeState !== "READY" || !claim.encryptedCredential) {
      return this.broker.finishJobFailure(
        claim,
        "CREDENTIAL_CHANGED"
      );
    }

    const provider = providerValue(claim.summary.provider);
    let connectorVersion: string;
    try {
      connectorVersion = this.connectors.version(provider);
    } catch {
      return this.broker.finishJobFailure(
        claim,
        "CREDENTIAL_VALIDATION_UNAVAILABLE"
      );
    }
    if (connectorVersion !== claim.summary.connectorVersion) {
      return this.broker.finishJobFailure(
        claim,
        "CONNECTOR_VERSION_CHANGED"
      );
    }
    if (
      !this.config.integrationCredentials.keys.has(
        claim.encryptedCredential.keyVersion
      )
    ) {
      return this.finishJobOnlyRetry(
        claim,
        "CREDENTIAL_KEY_VERSION_UNAVAILABLE",
        60
      );
    }

    let secret: ReturnType<IntegrationCredentialCryptoService["decrypt"]>;
    try {
      secret = this.crypto.decrypt(
        claim.summary.workspaceId,
        provider,
        claim.summary.credentialId,
        claim.encryptedCredential
      );
      if (secret.platformPool) {
        secret = selectIntegrationCredentialSecret(
          secret,
          claim.summary.credentialId,
          claim.summary.credentialId
        );
      }
    } catch {
      return this.finishJobOnlyRetry(
        claim,
        "CREDENTIAL_DECRYPTION_FAILED",
        60
      );
    }

    const leaseExpiresAt = claim.leaseExpiresAt
      ? Date.parse(claim.leaseExpiresAt)
      : Number.NaN;
    if (
      !Number.isFinite(leaseExpiresAt) ||
      leaseExpiresAt - Date.now() <
        this.config.integrationCredentialValidation.timeoutMs +
          PROVIDER_FINISH_SAFETY_MS
    ) {
      // Do not spend provider quota under a lease that can expire while the
      // request is in flight. The DB dispatcher will reclaim it after expiry.
      throw new CredentialValidationRetryError(
        "CREDENTIAL_VALIDATION_LEASE_BUDGET_EXHAUSTED"
      );
    }

    let result: CredentialValidationResult;
    try {
      result = await this.connectors.validate(
        provider,
        secret,
        this.config.integrationCredentialValidation.timeoutMs
      );
    } catch {
      return this.finishJobOnlyRetry(
        claim,
        "CREDENTIAL_VALIDATION_INTERNAL_ERROR"
      );
    }

    if (result.ok) {
      return this.broker.finishSuccess(
        claim,
        connectorVersion,
        result.providerMeta
      );
    }
    const failure = brokerProviderFailure(result);
    if (!failure) {
      return this.finishJobOnlyRetry(
        claim,
        "CREDENTIAL_VALIDATION_INTERNAL_ERROR"
      );
    }
    const summary = await this.broker.finishProviderFailure(
      claim,
      failure
    );
    if (summary.status === "RETRY_SCHEDULED") {
      throw new CredentialValidationRetryError(failure.errorCode);
    }
    return summary;
  }

  public pendingValidationIds(
    limit = 100
  ): Promise<readonly string[]> {
    return this.broker.pendingValidationIds(limit);
  }

  private async finishJobOnlyRetry(
    claim: CredentialValidationClaim,
    errorCode:
      | "CREDENTIAL_KEY_VERSION_UNAVAILABLE"
      | "CREDENTIAL_DECRYPTION_FAILED"
      | "CREDENTIAL_VALIDATION_INTERNAL_ERROR",
    retryAfterSeconds?: number
  ): Promise<IntegrationCredentialValidationSummary> {
    const summary = await this.broker.finishJobFailure(
      claim,
      errorCode,
      retryAfterSeconds
    );
    if (summary.status === "RETRY_SCHEDULED") {
      throw new CredentialValidationRetryError(errorCode);
    }
    return summary;
  }
}

class CredentialValidationRetryError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "CredentialValidationRetryError";
  }
}

function brokerProviderFailure(
  failure: Exclude<CredentialValidationResult, { readonly ok: true }>
): BrokerProviderFailure | undefined {
  const retryAfterSeconds = validRetryAfter(failure.retryAfterSeconds);
  if (
    failure.errorCode === "INVALID_CREDENTIAL" &&
    !failure.retryable &&
    failure.credentialStatus === "INVALID"
  ) {
    return {
      errorCode: failure.errorCode,
      credentialStatus: failure.credentialStatus,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
    };
  }
  if (
    failure.errorCode === "PROVIDER_RATE_LIMITED" &&
    failure.retryable &&
    failure.credentialStatus === "RATE_LIMITED"
  ) {
    return {
      errorCode: failure.errorCode,
      credentialStatus: failure.credentialStatus,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
    };
  }
  if (
    (failure.errorCode === "PROVIDER_UNAVAILABLE" ||
      failure.errorCode === "PROVIDER_PLAN_OR_REQUEST_REJECTED") &&
    failure.retryable ===
      (failure.errorCode === "PROVIDER_UNAVAILABLE") &&
    (failure.credentialStatus === undefined ||
      failure.credentialStatus === "DEGRADED")
  ) {
    return {
      errorCode: failure.errorCode,
      ...(failure.credentialStatus
        ? { credentialStatus: failure.credentialStatus }
        : {}),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
    };
  }
  return undefined;
}

function validRetryAfter(value: number | undefined): number | undefined {
  return value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 3_600
    ? value
    : undefined;
}

function providerValue(value: IntegrationProvider): IntegrationProvider {
  if (value === "XMLSTOCK" || value === "ARSENKIN" || value === "KEYS_SO") {
    return value;
  }
  throw new Error("Unsupported credential validation provider");
}

function assertLeaseOwner(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/u.test(value)) {
    throw new Error("Invalid credential validation lease owner");
  }
}

function validationNotFound(): NotFoundException {
  return new NotFoundException("Credential validation not found");
}
