import assert from "node:assert/strict";
import test from "node:test";
import {
  ConflictException,
  NotFoundException
} from "@nestjs/common";
import type { InternalCreateIntegrationCredentialValidationInput } from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import type {
  IntegrationCredential,
  Job,
  Prisma
} from "../generated/prisma/client.js";
import type { QueueService } from "../queue/queue.service.js";
import type { IntegrationCredentialConnectorRegistry } from "./integration-credential-connector.registry.js";
import {
  INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
  INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
  integrationCredentialValidationDeduplicationKey,
  integrationCredentialValidationRequestHash,
  integrationCredentialValidationScope,
  validationJobJson
} from "./integration-credential-validation-job.js";
import { IntegrationCredentialValidationService } from "./integration-credential-validation.service.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const actorId = "0190abcd-0000-7000-8000-0000000000a2";
const secondActorId = "0190abcd-0000-7000-8000-0000000000a3";
const credentialId = "0190abcd-0000-7000-8000-0000000000b3";
const validationId = "0190abcd-0000-7000-8000-0000000000c4";
const input: InternalCreateIntegrationCredentialValidationInput = {
  workspaceId,
  actorId,
  idempotencyKey: "credential-validation-001"
};

test("creates and reschedules one idempotent credential validation job", async () => {
  const credential = credentialRecord();
  let stored: Job | null = null;
  let createCount = 0;
  const enqueued: string[] = [];
  const prisma = {
    integrationCredential: {
      findFirst: async () => credential
    },
    job: {
      findUnique: async () => stored,
      findFirst: async () => null,
      create: async ({
        data
      }: {
        data: Readonly<Record<string, unknown>>;
      }) => {
        createCount += 1;
        stored = createdJob(data);
        return stored;
      }
    }
  } as unknown as PrismaService;
  const service = validationService(prisma, enqueued);

  const created = await service.request(
    credentialId,
    input,
    "request-1"
  );
  const replay = await service.request(
    credentialId,
    input,
    "request-2"
  );

  assert.equal(createCount, 1);
  assert.equal(created.id, validationId);
  assert.equal(replay.id, validationId);
  assert.equal(created.credentialMaterialVersion, 3);
  assert.deepEqual(enqueued, [validationId, validationId]);
  const persisted = stored as Job | null;
  if (!persisted) throw new Error("Validation job was not stored");
  assert.equal(
    persisted.idempotencyScope,
    integrationCredentialValidationScope(credentialId)
  );
  assert.equal(
    persisted.deduplicationKey,
    integrationCredentialValidationDeduplicationKey(
      credentialId,
      credential.materialVersion
    )
  );
  assert.equal(persisted.type, INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE);
  assert.equal(persisted.requestHash?.length, 32);
  assert.equal(persisted.estimatedCostMicro, 0n);
  assert.deepEqual(persisted.inputSnapshot, {
    kind: INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
    credentialId,
    credentialMaterialVersion: 3,
    connectorVersion: "keys-so@1.0.0"
  });
});

for (const scenario of [
  {
    name: "credential rotation",
    credential: credentialRecord({ materialVersion: 4 })
  },
  {
    name: "credential disable",
    credential: credentialRecord({ status: "DISABLED" })
  },
  {
    name: "credential revoke",
    credential: null
  }
] as const) {
  test(`replays the original accepted validation after ${scenario.name}`, async () => {
    const existing = jobRecord({
      status: "COMPLETED",
      finishedAt: new Date("2026-07-29T09:00:10.000Z"),
      requestHash: Uint8Array.from(
        integrationCredentialValidationRequestHash({
          workspaceId,
          actorId,
          credentialId
        })
      )
    });
    let credentialLookups = 0;
    const enqueued: string[] = [];
    const prisma = {
      integrationCredential: {
        findFirst: async () => {
          credentialLookups += 1;
          return scenario.credential;
        }
      },
      job: {
        findUnique: async () => existing
      }
    } as unknown as PrismaService;
    const service = validationService(prisma, enqueued);

    const replay = await service.request(
      credentialId,
      input,
      `request-replay-${scenario.name}`
    );

    assert.equal(replay.id, existing.id);
    assert.equal(replay.status, "SUCCEEDED");
    assert.equal(credentialLookups, 0);
    assert.deepEqual(enqueued, []);
  });
}

test("rejects reuse of an idempotency key by another actor", async () => {
  const credential = credentialRecord();
  const requestHash = integrationCredentialValidationRequestHash({
    workspaceId,
    actorId,
    credentialId
  });
  const existing = jobRecord({
    requestHash: Uint8Array.from(requestHash)
  });
  const prisma = {
    integrationCredential: {
      findFirst: async () => credential
    },
    job: {
      findUnique: async () => existing
    }
  } as unknown as PrismaService;
  const service = validationService(prisma, []);

  await assert.rejects(
    service.request(
      credentialId,
      { ...input, actorId: secondActorId },
      "request-2"
    ),
    ConflictException
  );
});

test("only reschedules an idempotent rate-limit validation after retryAt", async () => {
  const credential = credentialRecord();
  let existing = jobRecord({
    status: "WAITING_RATE_LIMIT",
    retryAt: new Date(Date.now() + 60_000),
    requestHash: Uint8Array.from(
      integrationCredentialValidationRequestHash({
        workspaceId,
        actorId,
        credentialId
      })
    )
  });
  const enqueued: string[] = [];
  const prisma = {
    integrationCredential: {
      findFirst: async () => credential
    },
    job: {
      findUnique: async () => existing
    }
  } as unknown as PrismaService;
  const service = validationService(prisma, enqueued);

  const waiting = await service.request(
    credentialId,
    input,
    "request-rate-limit-1"
  );
  assert.equal(waiting.status, "RETRY_SCHEDULED");
  assert.deepEqual(enqueued, []);

  existing = {
    ...existing,
    retryAt: new Date(0)
  };
  await service.request(
    credentialId,
    input,
    "request-rate-limit-2"
  );
  assert.deepEqual(enqueued, [existing.id]);
});

test("rejects another idempotency command while the credential material is being validated", async () => {
  const active = jobRecord({
    requestHash: Uint8Array.from(
      integrationCredentialValidationRequestHash({
        workspaceId,
        actorId,
        credentialId
      })
    )
  });
  const activeLookups: unknown[] = [];
  const enqueued: string[] = [];
  let createCount = 0;
  const prisma = {
    integrationCredential: {
      findFirst: async () => credentialRecord()
    },
    job: {
      findUnique: async () => null,
      findFirst: async (query: unknown) => {
        activeLookups.push(query);
        return active;
      },
      create: async () => {
        createCount += 1;
        throw new Error("must not create");
      }
    }
  } as unknown as PrismaService;
  const service = validationService(prisma, enqueued);

  await assert.rejects(
    service.request(
      credentialId,
      { ...input, idempotencyKey: "credential-validation-002" },
      "request-3"
    ),
    (error: unknown) =>
      error instanceof ConflictException &&
      error.message.includes("already running")
  );

  assert.equal(createCount, 0);
  assert.deepEqual(enqueued, []);
  assert.deepEqual(activeLookups, [
    {
      where: {
        workspaceId,
        type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
        deduplicationKey:
          integrationCredentialValidationDeduplicationKey(
            credentialId,
            3
          ),
        status: {
          in: [
            "QUEUED",
            "WAITING_RATE_LIMIT",
            "RUNNING",
            "RETRY_SCHEDULED"
          ]
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }
  ]);
});

test("returns the persisted idempotent winner after a concurrent create", async () => {
  const credential = credentialRecord();
  const winner = jobRecord({
    requestHash: Uint8Array.from(
      integrationCredentialValidationRequestHash({
        workspaceId,
        actorId,
        credentialId
      })
    )
  });
  let idempotentLookup = 0;
  const enqueued: string[] = [];
  const prisma = {
    integrationCredential: {
      findFirst: async () => credential
    },
    job: {
      findUnique: async () => {
        idempotentLookup += 1;
        return idempotentLookup === 1 ? null : winner;
      },
      findFirst: async () => null,
      create: async () => {
        throw { code: "P2002" };
      }
    }
  } as unknown as PrismaService;
  const service = validationService(prisma, enqueued);

  const result = await service.request(
    credentialId,
    input,
    "request-4"
  );

  assert.equal(result.id, winner.id);
  assert.deepEqual(enqueued, [winner.id]);
});

test("returns conflict when another idempotency command wins the active-key race", async () => {
  const credential = credentialRecord();
  const active = jobRecord();
  let activeLookup = 0;
  const enqueued: string[] = [];
  const prisma = {
    integrationCredential: {
      findFirst: async () => credential
    },
    job: {
      findUnique: async () => null,
      findFirst: async () => {
        activeLookup += 1;
        return activeLookup === 1 ? null : active;
      },
      create: async () => {
        throw { code: "P2002" };
      }
    }
  } as unknown as PrismaService;
  const service = validationService(prisma, enqueued);

  await assert.rejects(
    service.request(
      credentialId,
      { ...input, idempotencyKey: "credential-validation-002" },
      "request-5"
    ),
    (error: unknown) =>
      error instanceof ConflictException &&
      error.message.includes("already running")
  );

  assert.equal(activeLookup, 2);
  assert.deepEqual(enqueued, []);
});

test("hides a validation requested for another credential", async () => {
  const prisma = {
    job: {
      findFirst: async () => jobRecord()
    }
  } as unknown as PrismaService;
  const service = validationService(prisma, []);

  await assert.rejects(
    service.get(
      "0190abcd-0000-7000-8000-000000000099",
      validationId,
      workspaceId
    ),
    NotFoundException
  );
});

function validationService(
  prisma: PrismaService,
  enqueued: string[]
): IntegrationCredentialValidationService {
  const queue = {
    enqueueIntegrationCredentialValidation: async (id: string) => {
      enqueued.push(id);
    }
  } as unknown as QueueService;
  const connectors = {
    version: () => "keys-so@1.0.0"
  } as unknown as IntegrationCredentialConnectorRegistry;
  return new IntegrationCredentialValidationService(
    prisma,
    queue,
    connectors
  );
}

function createdJob(
  data: Readonly<Record<string, unknown>>
): Job {
  return jobRecord({
    workspaceId: String(data.workspaceId),
    type: String(data.type),
    status: "QUEUED",
    stage: String(data.stage),
    priority: Number(data.priority),
    actorId: String(data.actorId),
    deduplicationKey: String(data.deduplicationKey),
    idempotencyScope: String(data.idempotencyScope),
    idempotencyKey: String(data.idempotencyKey),
    requestHash: bytes(data.requestHash),
    inputSnapshot: data.inputSnapshot as Prisma.JsonValue,
    scopeSnapshot: data.scopeSnapshot as Prisma.JsonValue,
    progressTotal: BigInt(data.progressTotal as bigint),
    progressUnit: String(data.progressUnit),
    estimatedCostMicro: BigInt(data.estimatedCostMicro as bigint),
    credentialMode: "BYOK_API_KEY",
    provider: String(data.provider),
    maxAttempts: Number(data.maxAttempts),
    correlationId: String(data.correlationId),
    queuedAt: data.queuedAt as Date
  });
}

function jobRecord(overrides: Partial<Job> = {}): Job {
  const now = new Date("2026-07-29T09:00:00.000Z");
  return {
    billingQuoteId: null, billingCommandHash: null, billingMaximumUnitsMilli: null,
    dismissedAt: null, dismissedBy: null,
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
    idempotencyKey: input.idempotencyKey,
    requestHash: null,
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
    validationLeaseToken: null,
    leaseExpiresAt: null,
    retryAt: null,
    updatedAt: now,
    ...overrides
  };
}

function credentialRecord(
  overrides: Partial<IntegrationCredential> = {}
): IntegrationCredential {
  const now = new Date("2026-07-29T09:00:00.000Z");
  return {
    id: credentialId,
    workspaceId,
    provider: "KEYS_SO",
    label: "Primary",
    mode: "BYOK_API_KEY",
    status: "PENDING_VERIFICATION",
    ciphertext: Uint8Array.from([1]),
    nonce: Uint8Array.from([2]),
    authTag: Uint8Array.from([3]),
    encryptedDataKey: Uint8Array.from([4]),
    dataKeyNonce: Uint8Array.from([5]),
    dataKeyAuthTag: Uint8Array.from([6]),
    keyVersion: 1,
    displayHint: "••••-key",
    capabilities: ["SERP_COLLECTION"],
    providerMeta: {},
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

function bytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new Error("Expected byte array");
  }
  return Uint8Array.from(value);
}
