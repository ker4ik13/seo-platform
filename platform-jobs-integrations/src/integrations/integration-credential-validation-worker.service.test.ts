import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import { loadAppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import {
  Prisma,
  type IntegrationCredential,
  type Job
} from "../generated/prisma/client.js";
import type { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import {
  INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
  INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
  integrationCredentialValidationDeduplicationKey,
  integrationCredentialValidationScope,
  validationJobJson
} from "./integration-credential-validation-job.js";
import { IntegrationCredentialValidationWorkerService } from "./integration-credential-validation-worker.service.js";
import type { CredentialValidationResult } from "./integration-credential-validation.connector.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const actorId = "0190abcd-0000-7000-8000-0000000000a2";
const credentialId = "0190abcd-0000-7000-8000-0000000000b3";
const validationId = "0190abcd-0000-7000-8000-0000000000c4";
const leaseOwner = "connector-worker-1";

test("claims, decrypts and completes a credential validation", async () => {
  const fixture = workerFixture({
    result: {
      ok: true,
      providerMeta: {
        apiRequest: { limit: 100, usedLimit: 4 }
      }
    }
  });

  const summary = await fixture.worker.process(
    validationId,
    leaseOwner
  );

  assert.equal(summary.status, "SUCCEEDED");
  assert.equal(fixture.store.job.status, "COMPLETED");
  assert.equal(fixture.store.job.attempt, 1);
  assert.equal(fixture.store.job.progressCurrent, 1n);
  assert.equal(fixture.store.job.leaseOwner, null);
  assert.equal(fixture.store.credential.status, "ACTIVE");
  assert.deepEqual(fixture.store.credential.capabilities, [
    "KEYWORD_RESEARCH",
    "COMPETITOR_RESEARCH",
    "SERP_COLLECTION"
  ]);
  assert.ok(fixture.store.credential.verifiedAt instanceof Date);
  assert.equal(fixture.store.credential.lastErrorCode, null);
  assert.deepEqual(fixture.store.credential.providerMeta, {
    accountIdentifierConfigured: false,
    apiRequest: { limit: 100, usedLimit: 4 }
  });
  assert.deepEqual(fixture.observedSecrets, [
    {
      apiKey: "provider-api-key"
    }
  ]);
  assert.deepEqual(fixture.observedTimeouts, [10_000]);
});

test("marks an old material-version validation stale without provider access", async () => {
  const fixture = workerFixture({
    credential: { materialVersion: 4 },
    result: { ok: true }
  });

  const summary = await fixture.worker.process(
    validationId,
    leaseOwner
  );

  assert.equal(summary.status, "STALE");
  assert.equal(summary.errorCode, "CREDENTIAL_CHANGED");
  assert.equal(fixture.store.job.status, "FAILED_FINAL");
  assert.equal(fixture.store.credential.status, "PENDING_VERIFICATION");
  assert.deepEqual(fixture.observedSecrets, []);
});

test("throws sanitized retry errors and terminates the final retryable attempt", async () => {
  const fixture = workerFixture({
    result: {
      ok: false,
      errorCode: "PROVIDER_UNAVAILABLE",
      retryable: true,
      credentialStatus: "DEGRADED"
    }
  });

  await assert.rejects(
    fixture.worker.process(validationId, leaseOwner),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "CredentialValidationRetryError" &&
      error.message === "PROVIDER_UNAVAILABLE"
  );
  assert.equal(fixture.store.job.status, "RETRY_SCHEDULED");
  assert.equal(fixture.store.job.attempt, 1);
  assert.equal(fixture.store.job.finishedAt, null);
  assert.equal(
    fixture.store.credential.status,
    "PENDING_VERIFICATION"
  );
  assert.equal(
    fixture.store.credential.lastErrorCode,
    "PROVIDER_UNAVAILABLE"
  );
  assert.ok(fixture.store.job.retryAt instanceof Date);

  const notDue = await fixture.worker.process(
    validationId,
    leaseOwner
  );
  assert.equal(notDue.status, "RETRY_SCHEDULED");
  assert.equal(fixture.observedSecrets.length, 1);

  fixture.store.job = {
    ...fixture.store.job,
    retryAt: new Date(0)
  };
  await assert.rejects(
    fixture.worker.process(validationId, leaseOwner),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "CredentialValidationRetryError"
  );
  assert.equal(fixture.store.job.status, "RETRY_SCHEDULED");
  assert.equal(fixture.store.job.attempt, 2);

  fixture.store.job = {
    ...fixture.store.job,
    retryAt: new Date(0)
  };
  const terminal = await fixture.worker.process(
    validationId,
    leaseOwner
  );
  assert.equal(terminal.status, "FAILED_RETRYABLE");
  assert.equal(terminal.errorCode, "PROVIDER_UNAVAILABLE");
  assert.equal(fixture.store.job.status, "FAILED_RETRYABLE");
  assert.equal(fixture.store.job.attempt, 3);
  assert.ok(
    ((fixture.store as WorkerStore).job.finishedAt as Date | null) instanceof
      Date
  );
  assert.equal(fixture.observedSecrets.length, 3);
  assert.equal(fixture.store.job.retryAt, null);
});

test("waits until provider Retry-After when rate limited", async () => {
  const fixture = workerFixture({
    result: {
      ok: false,
      errorCode: "PROVIDER_RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 30,
      credentialStatus: "RATE_LIMITED"
    }
  });

  await assert.rejects(
    fixture.worker.process(validationId, leaseOwner),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "CredentialValidationRetryError" &&
      error.message === "PROVIDER_RATE_LIMITED"
  );

  assert.equal(fixture.store.job.status, "WAITING_RATE_LIMIT");
  assert.equal(
    fixture.store.job.stage,
    "credential_validation_waiting_rate_limit"
  );
  assert.ok(fixture.store.job.retryAt instanceof Date);
  const remainingMs =
    fixture.store.job.retryAt.getTime() - Date.now();
  assert.ok(remainingMs >= 29_000);
  assert.ok(remainingMs <= 30_000);
  assert.equal(fixture.store.credential.status, "RATE_LIMITED");

  const pending = await fixture.worker.process(
    validationId,
    leaseOwner
  );
  assert.equal(pending.status, "RETRY_SCHEDULED");
  assert.equal(
    pending.retryAt,
    fixture.store.job.retryAt.toISOString()
  );
  assert.equal(fixture.observedSecrets.length, 1);
});

test("maps a provider authentication failure to an invalid credential", async () => {
  const fixture = workerFixture({
    result: {
      ok: false,
      errorCode: "INVALID_CREDENTIAL",
      retryable: false,
      credentialStatus: "INVALID"
    }
  });

  const summary = await fixture.worker.process(
    validationId,
    leaseOwner
  );

  assert.equal(summary.status, "FAILED_FINAL");
  assert.equal(summary.errorCode, "INVALID_CREDENTIAL");
  assert.equal(fixture.store.credential.status, "INVALID");
  assert.equal(
    fixture.store.credential.lastErrorCode,
    "INVALID_CREDENTIAL"
  );
  assert.ok(fixture.store.credential.lastErrorAt instanceof Date);
});

test("retries a decrypt failure without mutating credential state", async () => {
  const fixture = workerFixture({
    credential: {
      authTag: Uint8Array.from({ length: 16 }, () => 0)
    },
    result: { ok: true }
  });
  const credentialBefore = { ...fixture.store.credential };

  await assert.rejects(
    fixture.worker.process(validationId, leaseOwner),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "CredentialValidationRetryError" &&
      error.message === "CREDENTIAL_DECRYPTION_FAILED"
  );

  assert.equal(fixture.store.job.status, "RETRY_SCHEDULED");
  assert.equal(
    object(fixture.store.job.errorSummary)?.code,
    "CREDENTIAL_DECRYPTION_FAILED"
  );
  assert.ok(fixture.store.job.retryAt instanceof Date);
  assert.deepEqual(fixture.store.credential, credentialBefore);
  assert.deepEqual(fixture.observedSecrets, []);
});

test("exhausts decrypt retries without mutating credential state", async () => {
  const fixture = workerFixture({
    credential: {
      authTag: Uint8Array.from({ length: 16 }, () => 0)
    },
    job: {
      attempt: 2,
      maxAttempts: 3
    },
    result: { ok: true }
  });
  const credentialBefore = { ...fixture.store.credential };

  const summary = await fixture.worker.process(
    validationId,
    leaseOwner
  );

  assert.equal(summary.status, "FAILED_RETRYABLE");
  assert.equal(summary.errorCode, "CREDENTIAL_DECRYPTION_FAILED");
  assert.equal(fixture.store.job.status, "FAILED_RETRYABLE");
  assert.equal(fixture.store.job.attempt, 3);
  assert.equal(fixture.store.job.retryAt, null);
  assert.ok(fixture.store.job.finishedAt instanceof Date);
  assert.deepEqual(fixture.store.credential, credentialBefore);
  assert.deepEqual(fixture.observedSecrets, []);
});

test("retries a missing KEK version without mutating the credential", async () => {
  const fixture = workerFixture({
    credential: {
      keyVersion: 2,
      status: "ACTIVE",
      verifiedAt: new Date("2026-07-29T08:00:00.000Z")
    },
    result: { ok: true }
  });
  const credentialBefore = { ...fixture.store.credential };

  await assert.rejects(
    fixture.worker.process(validationId, leaseOwner),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "CredentialValidationRetryError" &&
      error.message === "CREDENTIAL_KEY_VERSION_UNAVAILABLE"
  );

  assert.equal(fixture.store.job.status, "RETRY_SCHEDULED");
  assert.equal(
    object(fixture.store.job.errorSummary)?.code,
    "CREDENTIAL_KEY_VERSION_UNAVAILABLE"
  );
  assert.ok(fixture.store.job.retryAt instanceof Date);
  assert.deepEqual(fixture.store.credential, credentialBefore);
  assert.deepEqual(fixture.observedSecrets, []);
});

test("terminalizes an already disabled credential without mutating it", async () => {
  const fixture = workerFixture({
    credential: { status: "DISABLED", version: 7 },
    result: { ok: true }
  });

  const summary = await fixture.worker.process(
    validationId,
    leaseOwner
  );

  assert.equal(summary.status, "FAILED_FINAL");
  assert.equal(summary.errorCode, "CREDENTIAL_DISABLED");
  assert.equal(fixture.store.job.status, "FAILED_FINAL");
  assert.equal(fixture.store.credential.status, "DISABLED");
  assert.equal(fixture.store.credential.version, 7);
  assert.deepEqual(fixture.observedSecrets, []);
});

test("does not exhaust a live running validation on duplicate delivery", async () => {
  const fixture = workerFixture({
    job: {
      status: "RUNNING",
      attempt: 3,
      maxAttempts: 3,
      leaseOwner: "another-worker",
      leaseExpiresAt: new Date(Date.now() + 60_000),
      startedAt: new Date()
    },
    result: { ok: true }
  });

  const summary = await fixture.worker.process(
    validationId,
    leaseOwner
  );

  assert.equal(summary.status, "RUNNING");
  assert.equal(fixture.store.job.status, "RUNNING");
  assert.equal(fixture.store.job.leaseOwner, "another-worker");
  assert.deepEqual(fixture.observedSecrets, []);
});

test("terminalizes an exhausted due retry and clears scheduling state", async () => {
  const fixture = workerFixture({
    job: {
      status: "RETRY_SCHEDULED",
      attempt: 3,
      maxAttempts: 3,
      retryAt: new Date(0),
      resultSummary: { obsolete: true }
    },
    result: { ok: true }
  });

  const summary = await fixture.worker.process(
    validationId,
    leaseOwner
  );

  assert.equal(summary.status, "FAILED_RETRYABLE");
  assert.equal(summary.errorCode, "VALIDATION_ATTEMPTS_EXHAUSTED");
  assert.equal(fixture.store.job.retryAt, null);
  assert.equal(fixture.store.job.leaseOwner, null);
  assert.equal(fixture.store.job.leaseExpiresAt, null);
  assert.equal(fixture.store.job.resultSummary, null);
  assert.deepEqual(fixture.observedSecrets, []);
});

test("returns only due queued/retry jobs and expired running validations", async () => {
  let query: Readonly<Record<string, unknown>> | undefined;
  const prisma = {
    job: {
      findMany: async (input: Readonly<Record<string, unknown>>) => {
        query = input;
        return [{ id: validationId }];
      }
    }
  } as unknown as PrismaService;
  const config = executionTestConfig();
  const worker = new IntegrationCredentialValidationWorkerService(
    prisma,
    {} as IntegrationCredentialCryptoService,
    {} as IntegrationCredentialConnectorRegistry,
    config
  );

  const result = await worker.pendingValidationIds(5_000);

  assert.deepEqual(result, [validationId]);
  assert.ok(query);
  assert.equal(query.take, 500);
  const where = query.where as Readonly<Record<string, unknown>>;
  const branches = where.OR as readonly Readonly<
    Record<string, unknown>
  >[];
  assert.equal(
    where.type,
    INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE
  );
  const scheduled = branches[0];
  assert.ok(scheduled);
  assert.deepEqual(scheduled.status, {
    in: [
      "QUEUED",
      "RETRY_SCHEDULED",
      "WAITING_RATE_LIMIT"
    ]
  });
  const due = scheduled.OR as readonly Readonly<
    Record<string, unknown>
  >[];
  assert.deepEqual(due[0], { retryAt: null });
  assert.ok(
    object(object(due[1])?.retryAt)?.lte instanceof Date
  );
  assert.equal(branches[1]?.status, "RUNNING");
});

interface WorkerFixtureOptions {
  readonly credential?: Partial<IntegrationCredential>;
  readonly job?: Partial<Job>;
  readonly result: CredentialValidationResult;
}

function workerFixture(options: WorkerFixtureOptions): {
  readonly worker: IntegrationCredentialValidationWorkerService;
  readonly store: WorkerStore;
  readonly observedSecrets: unknown[];
  readonly observedTimeouts: number[];
} {
  const config = executionTestConfig();
  const crypto = new IntegrationCredentialCryptoService(config);
  const managerCrypto = new IntegrationCredentialCryptoService(
    managementTestConfig()
  );
  const store: WorkerStore = {
    job: jobRecord(options.job),
    credential: credentialRecord(managerCrypto, options.credential)
  };
  const prisma = workerPrisma(store);
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
  return {
    worker: new IntegrationCredentialValidationWorkerService(
      prisma,
      crypto,
      connectors,
      config
    ),
    store,
    observedSecrets,
    observedTimeouts
  };
}

interface WorkerStore {
  job: Job;
  credential: IntegrationCredential;
}

function workerPrisma(store: WorkerStore): PrismaService {
  const client = {
    job: {
      findFirst: async ({
        where
      }: {
        where: Readonly<Record<string, unknown>>;
      }) => (matchesJob(store.job, where) ? store.job : null),
      findUnique: async ({
        where
      }: {
        where: Readonly<Record<string, unknown>>;
      }) => (where.id === store.job.id ? store.job : null),
      updateMany: async ({
        where,
        data
      }: {
        where: Readonly<Record<string, unknown>>;
        data: Readonly<Record<string, unknown>>;
      }) => {
        if (!matchesJob(store.job, where)) return { count: 0 };
        store.job = applyRecordUpdate(store.job, data);
        return { count: 1 };
      }
    },
    integrationCredential: {
      findFirst: async ({
        where
      }: {
        where: Readonly<Record<string, unknown>>;
      }) =>
        matchesCredential(store.credential, where)
          ? store.credential
          : null,
      updateMany: async ({
        where,
        data
      }: {
        where: Readonly<Record<string, unknown>>;
        data: Readonly<Record<string, unknown>>;
      }) => {
        if (!matchesCredential(store.credential, where)) {
          return { count: 0 };
        }
        store.credential = applyRecordUpdate(
          store.credential,
          data
        );
        return { count: 1 };
      }
    },
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>
    ) => callback(client)
  };
  return client as unknown as PrismaService;
}

function matchesJob(
  job: Job,
  where: Readonly<Record<string, unknown>>
): boolean {
  if (where.id !== undefined && where.id !== job.id) return false;
  if (where.type !== undefined && where.type !== job.type) return false;
  if (where.status !== undefined && where.status !== job.status) {
    return false;
  }
  if (where.version !== undefined && where.version !== job.version) {
    return false;
  }
  if (
    where.leaseOwner !== undefined &&
    where.leaseOwner !== job.leaseOwner
  ) {
    return false;
  }
  const attempt = object(where.attempt);
  if (
    attempt?.lt !== undefined &&
    job.attempt >= Number(attempt.lt)
  ) {
    return false;
  }
  if (
    attempt?.gte !== undefined &&
    job.attempt < Number(attempt.gte)
  ) {
    return false;
  }
  return true;
}

function matchesCredential(
  credential: IntegrationCredential,
  where: Readonly<Record<string, unknown>>
): boolean {
  if (where.id !== undefined && where.id !== credential.id) return false;
  if (
    where.workspaceId !== undefined &&
    where.workspaceId !== credential.workspaceId
  ) {
    return false;
  }
  if (
    where.materialVersion !== undefined &&
    where.materialVersion !== credential.materialVersion
  ) {
    return false;
  }
  if (where.deletedAt === null && credential.deletedAt !== null) {
    return false;
  }
  const status = object(where.status);
  if (
    Array.isArray(status?.notIn) &&
    status.notIn.includes(credential.status)
  ) {
    return false;
  }
  return true;
}

function applyRecordUpdate<RecordType extends object>(
  record: RecordType,
  data: Readonly<Record<string, unknown>>
): RecordType {
  const updated = { ...record } as Record<string, unknown>;
  for (const [field, value] of Object.entries(data)) {
    if (value === Prisma.DbNull) {
      updated[field] = null;
      continue;
    }
    const operation = object(value);
    if (operation?.increment !== undefined) {
      const current = updated[field];
      updated[field] =
        typeof current === "bigint"
          ? current + BigInt(Number(operation.increment))
          : Number(current) + Number(operation.increment);
      continue;
    }
    updated[field] = value;
  }
  return updated as RecordType;
}

function jobRecord(overrides: Partial<Job> = {}): Job {
  const now = new Date("2026-07-29T09:00:00.000Z");
  return {
    id: validationId,
    workspaceId,
    projectId: null,
    type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
    status: "QUEUED",
    stage: "credential_validation_queued",
    priority: 10,
    actorId,
    scheduleId: null,
    parentJobId: null,
    deduplicationKey:
      integrationCredentialValidationDeduplicationKey(
        credentialId,
        3
      ),
    idempotencyScope:
      integrationCredentialValidationScope(credentialId),
    idempotencyKey: "credential-validation-001",
    requestHash: Uint8Array.from({ length: 32 }, () => 1),
    inputSnapshot: validationJobJson({
      kind: INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
      credentialId,
      credentialMaterialVersion: 3,
      connectorVersion: "keys-so@1.0.0"
    }) as Prisma.JsonValue,
    scopeSnapshot: validationJobJson({
      workspaceId,
      credentialId
    }) as Prisma.JsonValue,
    progressCurrent: 0n,
    progressTotal: 1n,
    progressUnit: "credential",
    estimatedCostMicro: null,
    reservedCostMicro: null,
    actualCostMicro: null,
    currency: null,
    credentialMode: "BYOK_API_KEY",
    provider: "KEYS_SO",
    attempt: 0,
    maxAttempts: 3,
    errorSummary: null,
    resultSummary: null,
    correlationId: "request-1",
    version: 1,
    createdAt: now,
    queuedAt: now,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    retryAt: null,
    updatedAt: now,
    ...overrides
  };
}

function credentialRecord(
  crypto: IntegrationCredentialCryptoService,
  overrides: Partial<IntegrationCredential> = {}
): IntegrationCredential {
  const encrypted = crypto.encrypt(
    workspaceId,
    "KEYS_SO",
    credentialId,
    { apiKey: "provider-api-key" }
  );
  const now = new Date("2026-07-29T09:00:00.000Z");
  return {
    id: credentialId,
    workspaceId,
    provider: "KEYS_SO",
    label: "Primary",
    mode: "BYOK_API_KEY",
    status: "PENDING_VERIFICATION",
    ciphertext: Uint8Array.from(encrypted.ciphertext),
    nonce: Uint8Array.from(encrypted.nonce),
    authTag: Uint8Array.from(encrypted.authTag),
    encryptedDataKey: Uint8Array.from(encrypted.encryptedDataKey),
    dataKeyNonce: Uint8Array.from(encrypted.dataKeyNonce),
    dataKeyAuthTag: Uint8Array.from(encrypted.dataKeyAuthTag),
    keyVersion: encrypted.keyVersion,
    displayHint: "••••-key",
    capabilities: ["SERP_COLLECTION"],
    providerMeta: { accountIdentifierConfigured: false },
    idempotencyKey: "credential-create-001",
    requestFingerprint: Uint8Array.from({ length: 32 }, () => 1),
    fingerprintKeyVersion: 1,
    materialVersion: 3,
    createdBy: actorId,
    updatedBy: actorId,
    verifiedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides
  };
}

function managementTestConfig(): AppConfig {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
  const fingerprintKey = Buffer.alloc(32, 8).toString("base64url");
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIALS_ENABLED: "true",
    INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `1:${fingerprintKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "1",
    PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32)
  });
}

function executionTestConfig(): AppConfig {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
    INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
  });
}

function object(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
