import assert from "node:assert/strict";
import test from "node:test";
import type { IntegrationCredentialValidationSummary } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { loadAppConfig } from "../config/app-config.js";
import type { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";
import {
  IntegrationCredentialCryptoService,
  type EncryptedIntegrationCredential
} from "./integration-credential-crypto.service.js";
import type {
  CredentialValidationClaim,
  CredentialValidationJobErrorCode,
  IntegrationCredentialExecutionBrokerService
} from "./integration-credential-execution-broker.service.js";
import { IntegrationCredentialValidationWorkerService } from "./integration-credential-validation-worker.service.js";
import type { CredentialValidationResult } from "./integration-credential-validation.connector.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const credentialId = "0190abcd-0000-7000-8000-0000000000b3";
const validationId = "0190abcd-0000-7000-8000-0000000000c4";
const leaseToken = "0190abcd-0000-7000-8000-0000000000d5";
const leaseOwner = "connector-worker-1";

test("uses only a claimed broker projection to decrypt and finish success", async () => {
  const fixture = workerFixture({
    result: {
      ok: true,
      providerMeta: { apiRequest: { limit: 100, usedLimit: 4 } }
    }
  });

  const result = await fixture.worker.process(validationId, leaseOwner);

  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(fixture.observedSecrets, [{ apiKey: "provider-api-key" }]);
  assert.deepEqual(fixture.observedTimeouts, [10_000]);
  assert.equal(fixture.calls.finishSuccess.length, 1);
  assert.deepEqual(fixture.calls.finishSuccess[0]?.providerMeta, {
    apiRequest: { limit: 100, usedLimit: 4 }
  });
  assert.deepEqual(fixture.calls.jobFailures, []);
  assert.deepEqual(fixture.calls.providerFailures, []);
});

for (const scenario of [
  ["STALE", "CREDENTIAL_CHANGED"],
  ["DISABLED", "CREDENTIAL_DISABLED"],
  ["MODE_UNSUPPORTED", "CREDENTIAL_MODE_UNSUPPORTED"]
] as const) {
  test(`terminalizes ${scenario[0]} scope without provider access`, async () => {
    const fixture = workerFixture({
      claim: nonReadyClaim(scenario[0]),
      result: { ok: true }
    });

    const result = await fixture.worker.process(validationId, leaseOwner);

    assert.equal(result.status, "FAILED_FINAL");
    assert.equal(result.errorCode, scenario[1]);
    assert.deepEqual(fixture.calls.jobFailures, [scenario[1]]);
    assert.deepEqual(fixture.observedSecrets, []);
  });
}

test("returns a safe duplicate summary without decrypting or finishing", async () => {
  const summary = validationSummary({ status: "RUNNING" });
  const fixture = workerFixture({
    claim: {
      outcome: "NOT_CLAIMABLE",
      scopeState: "NOT_APPLICABLE",
      summary,
      jobVersion: 3
    },
    result: { ok: true }
  });

  assert.deepEqual(
    await fixture.worker.process(validationId, leaseOwner),
    summary
  );
  assert.deepEqual(fixture.observedSecrets, []);
  assert.deepEqual(fixture.calls.jobFailures, []);
});

test("maps a finite provider rate-limit result through the atomic broker finish", async () => {
  const fixture = workerFixture({
    result: {
      ok: false,
      errorCode: "PROVIDER_RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 30,
      credentialStatus: "RATE_LIMITED"
    },
    providerFailureSummary: validationSummary({
      status: "RETRY_SCHEDULED",
      errorCode: "PROVIDER_RATE_LIMITED",
      retryAt: "2026-07-30T10:01:00.000Z"
    })
  });

  assert.equal(
    (await fixture.worker.process(validationId, leaseOwner)).status,
    "RETRY_SCHEDULED"
  );
  assert.deepEqual(fixture.calls.providerFailures, [
    {
      errorCode: "PROVIDER_RATE_LIMITED",
      credentialStatus: "RATE_LIMITED",
      retryAfterSeconds: 30
    }
  ]);
  assert.deepEqual(fixture.calls.jobFailures, []);
});

test("keeps decrypt failures on the job-only finish path", async () => {
  const encrypted = encryptedCredential();
  const fixture = workerFixture({
    claim: claimed({
      encryptedCredential: {
        ...encrypted,
        authTag: Buffer.alloc(encrypted.authTag.length)
      }
    }),
    result: { ok: true },
    jobFailureSummary: validationSummary({
      status: "RETRY_SCHEDULED",
      errorCode: "CREDENTIAL_DECRYPTION_FAILED",
      retryAt: "2026-07-30T10:01:00.000Z"
    })
  });

  assert.equal(
    (await fixture.worker.process(validationId, leaseOwner)).status,
    "RETRY_SCHEDULED"
  );
  assert.deepEqual(fixture.calls.jobFailures, [
    "CREDENTIAL_DECRYPTION_FAILED"
  ]);
  assert.deepEqual(fixture.calls.providerFailures, []);
  assert.deepEqual(fixture.observedSecrets, []);
});

for (const [name, leaseExpiresAt] of [
  ["insufficient", new Date(Date.now() + 11_000).toISOString()],
  ["invalid", "not-a-timestamp"]
] as const) {
  test(`does not call the provider with ${name} remaining lease budget`, async () => {
    const fixture = workerFixture({
      claim: claimed({ leaseExpiresAt }),
      result: { ok: true }
    });

    assert.equal(
      (await fixture.worker.process(validationId, leaseOwner)).status,
      "RUNNING"
    );
    assert.deepEqual(fixture.observedSecrets, []);
    assert.deepEqual(fixture.observedTimeouts, []);
    assert.deepEqual(fixture.calls.finishSuccess, []);
    assert.deepEqual(fixture.calls.providerFailures, []);
  });
}

test("fails closed on a provider response outside the finite vocabulary", async () => {
  const fixture = workerFixture({
    result: {
      ok: false,
      errorCode: "SOMETHING_NEW",
      retryable: true,
      credentialStatus: "DEGRADED"
    },
    jobFailureSummary: validationSummary({
      status: "RETRY_SCHEDULED",
      errorCode: "CREDENTIAL_VALIDATION_INTERNAL_ERROR",
      retryAt: "2026-07-30T10:01:00.000Z"
    })
  });

  assert.equal(
    (await fixture.worker.process(validationId, leaseOwner)).status,
    "RETRY_SCHEDULED"
  );
  assert.deepEqual(fixture.calls.jobFailures, [
    "CREDENTIAL_VALIDATION_INTERNAL_ERROR"
  ]);
  assert.deepEqual(fixture.calls.providerFailures, []);
});

test("delegates due-id discovery to the narrow broker", async () => {
  const fixture = workerFixture({ result: { ok: true } });

  assert.deepEqual(await fixture.worker.pendingValidationIds(5_000), [
    validationId
  ]);
  assert.deepEqual(fixture.calls.pendingLimits, [5_000]);
});

test("rejects an unsafe lease owner before calling the broker", async () => {
  const fixture = workerFixture({ result: { ok: true } });

  await assert.rejects(
    fixture.worker.process(validationId, "owner with spaces"),
    /Invalid credential validation lease owner/u
  );
  assert.equal(fixture.calls.claims, 0);
});

interface FixtureOptions {
  readonly claim?: CredentialValidationClaim;
  readonly result: CredentialValidationResult;
  readonly jobFailureSummary?: IntegrationCredentialValidationSummary;
  readonly providerFailureSummary?: IntegrationCredentialValidationSummary;
}

interface FixtureCalls {
  claims: number;
  readonly pendingLimits: number[];
  readonly jobFailures: CredentialValidationJobErrorCode[];
  readonly providerFailures: unknown[];
  readonly finishSuccess: Array<{
    readonly connectorVersion: string;
    readonly providerMeta?: Readonly<Record<string, unknown>>;
  }>;
}

function workerFixture(options: FixtureOptions): {
  readonly worker: IntegrationCredentialValidationWorkerService;
  readonly calls: FixtureCalls;
  readonly observedSecrets: unknown[];
  readonly observedTimeouts: number[];
} {
  const calls: FixtureCalls = {
    claims: 0,
    pendingLimits: [],
    jobFailures: [],
    providerFailures: [],
    finishSuccess: []
  };
  const broker = {
    claimValidation: async () => {
      calls.claims += 1;
      return options.claim ?? claimed();
    },
    pendingValidationIds: async (limit: number) => {
      calls.pendingLimits.push(limit);
      return [validationId];
    },
    finishJobFailure: async (
      _claim: CredentialValidationClaim,
      errorCode: CredentialValidationJobErrorCode
    ) => {
      calls.jobFailures.push(errorCode);
      return (
        options.jobFailureSummary ??
        validationSummary({ status: "FAILED_FINAL", errorCode })
      );
    },
    finishProviderFailure: async (
      _claim: CredentialValidationClaim,
      input: unknown
    ) => {
      calls.providerFailures.push(input);
      return (
        options.providerFailureSummary ??
        validationSummary({ status: "FAILED_FINAL" })
      );
    },
    finishSuccess: async (
      _claim: CredentialValidationClaim,
      connectorVersion: string,
      providerMeta: Readonly<Record<string, unknown>> | undefined
    ) => {
      calls.finishSuccess.push({
        connectorVersion,
        ...(providerMeta ? { providerMeta } : {})
      });
      return validationSummary({ status: "SUCCEEDED" });
    }
  } as unknown as IntegrationCredentialExecutionBrokerService;
  const observedSecrets: unknown[] = [];
  const observedTimeouts: number[] = [];
  const connectors = {
    version: () => "keys-so@1.0.0",
    validate: async (
      _provider: string,
      secret: unknown,
      timeoutMs: number
    ) => {
      observedSecrets.push(secret);
      observedTimeouts.push(timeoutMs);
      return options.result;
    }
  } as unknown as IntegrationCredentialConnectorRegistry;
  const config = executionConfig();
  return {
    worker: new IntegrationCredentialValidationWorkerService(
      broker,
      new IntegrationCredentialCryptoService(config),
      connectors,
      config
    ),
    calls,
    observedSecrets,
    observedTimeouts
  };
}

function claimed(
  overrides: Partial<CredentialValidationClaim> = {}
): CredentialValidationClaim {
  return {
    outcome: "CLAIMED",
    scopeState: "READY",
    summary: validationSummary(),
    leaseOwner,
    leaseToken,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    jobVersion: 2,
    encryptedCredential: encryptedCredential(),
    ...overrides
  };
}

function nonReadyClaim(
  scopeState: Extract<
    CredentialValidationClaim["scopeState"],
    "STALE" | "DISABLED" | "MODE_UNSUPPORTED"
  >
): CredentialValidationClaim {
  return {
    outcome: "CLAIMED",
    scopeState,
    summary: validationSummary(),
    leaseOwner,
    leaseToken,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    jobVersion: 2
  };
}

function validationSummary(
  overrides: Partial<IntegrationCredentialValidationSummary> = {}
): IntegrationCredentialValidationSummary {
  return {
    id: validationId,
    workspaceId,
    credentialId,
    credentialMaterialVersion: 3,
    provider: "KEYS_SO",
    status: "RUNNING",
    connectorVersion: "keys-so@1.0.0",
    requestedAt: "2026-07-30T10:00:00.000Z",
    startedAt: "2026-07-30T10:00:01.000Z",
    ...overrides
  };
}

function encryptedCredential(): EncryptedIntegrationCredential {
  return new IntegrationCredentialCryptoService(managementConfig()).encrypt(
    workspaceId,
    "KEYS_SO",
    credentialId,
    { apiKey: "provider-api-key" }
  );
}

function managementConfig(): AppConfig {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
  const fingerprintKey = Buffer.alloc(32, 8).toString("base64url");
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIAL_ROLE: "MANAGEMENT",
    INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `1:${fingerprintKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "1",
    PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32)
  });
}

function executionConfig(): AppConfig {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
    INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
  });
}
