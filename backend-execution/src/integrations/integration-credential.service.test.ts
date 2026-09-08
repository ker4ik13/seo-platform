import assert from "node:assert/strict";
import test from "node:test";
import {
  ConflictException,
  UnprocessableEntityException
} from "@nestjs/common";
import type {
  InternalCreateIntegrationCredentialInput,
  InternalEnablePlatformIntegrationCredentialInput
} from "@seo-platform/contracts";
import { loadAppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type {
  IntegrationCredential,
  Job
} from "../generated/prisma/client.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import { internalCreateIntegrationCredentialInput } from "./integration-credential-input.js";
import { IntegrationCredentialService } from "./integration-credential.service.js";
import {
  INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
  INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
  integrationCredentialValidationDeduplicationKey,
  integrationCredentialValidationScope
} from "./integration-credential-validation-job.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const actorId = "0190abcd-0000-7000-8000-0000000000a2";
const credentialId = "0190abcd-0000-7000-8000-0000000000b3";
const validationId = "0190abcd-0000-7000-8000-0000000000c4";
const createInput: InternalCreateIntegrationCredentialInput =
  internalCreateIntegrationCredentialInput({
    workspaceId: workspaceId.toUpperCase(),
    actorId: actorId.toUpperCase(),
    idempotencyKey: "credential-create-001",
    provider: "XMLSTOCK",
    label: "Primary",
    apiKey: "secret-api-key",
    accountIdentifier: "account-1"
  });
const platformInput: InternalEnablePlatformIntegrationCredentialInput = {
  workspaceId,
  actorId,
  idempotencyKey: "platform-credential-enable-001",
  provider: "XMLSTOCK"
};
const platformMaterial = [
  {
    apiKey: "platform-xmlstock-secret-1",
    accountIdentifier: "platform-account-1"
  },
  {
    apiKey: "platform-xmlstock-secret-2",
    accountIdentifier: "platform-account-2"
  }
] as const;

test("lists the bounded active validation for the current credential material", async () => {
  const crypto = testCrypto();
  const credential = credentialRecord(crypto, createInput, {
    materialVersion: 3,
    capabilities: ["SERP_COLLECTION", "CLUSTERING", 42]
  });
  const validation = validationJobRecord({
    deduplicationKey:
      integrationCredentialValidationDeduplicationKey(
        credentialId,
        3
      ),
    inputSnapshot: {
      kind: INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
      credentialId,
      credentialMaterialVersion: 3,
      connectorVersion: "xmlstock@1.1.0"
    }
  });
  let validationQuery: unknown;
  const prisma = {
    integrationCredential: {
      findMany: async () => [credential]
    },
    job: {
      findMany: async (query: unknown) => {
        validationQuery = query;
        return [validation];
      }
    }
  } as unknown as PrismaService;

  const result = await new IntegrationCredentialService(
    prisma,
    crypto
  ).list(workspaceId);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.activeValidation?.id, validationId);
  assert.equal(
    result[0]?.activeValidation?.credentialMaterialVersion,
    3
  );
  assert.deepEqual(result[0]?.capabilities, ["SERP_COLLECTION"]);
  assert.deepEqual(validationQuery, {
    where: {
      workspaceId,
      type: INTEGRATION_CREDENTIAL_VALIDATION_JOB_TYPE,
      status: {
        in: [
          "QUEUED",
          "WAITING_RATE_LIMIT",
          "RUNNING",
          "RETRY_SCHEDULED"
        ]
      },
      deduplicationKey: {
        in: [
          integrationCredentialValidationDeduplicationKey(
            credentialId,
            3
          )
        ]
      }
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
});

test("does not query validation jobs for an empty credential list", async () => {
  const crypto = testCrypto();
  let validationQueries = 0;
  const prisma = {
    integrationCredential: {
      findMany: async () => []
    },
    job: {
      findMany: async () => {
        validationQueries += 1;
        return [];
      }
    }
  } as unknown as PrismaService;

  const result = await new IntegrationCredentialService(
    prisma,
    crypto
  ).list(workspaceId);

  assert.deepEqual(result, []);
  assert.equal(validationQueries, 0);
});

test("projects only a normalized provider quota without exposing provider metadata", async () => {
  const crypto = testCrypto();
  const credential = credentialRecord(crypto, createInput, {
    provider: "ARSENKIN",
    providerMeta: {
      limitsTotal: 12_345,
      nestedSecret: "must-not-cross-boundary"
    },
    lastSuccessAt: new Date("2026-08-02T12:00:00.000Z")
  });
  const prisma = {
    integrationCredential: { findMany: async () => [credential] },
    job: { findMany: async () => [] }
  } as unknown as PrismaService;

  const result = await new IntegrationCredentialService(
    prisma,
    crypto
  ).list(workspaceId);

  assert.deepEqual(result[0]?.quota, {
    status: "AVAILABLE",
    unit: "ARSENKIN_LIMITS",
    remaining: 12_345,
    observedAt: "2026-08-02T12:00:00.000Z"
  });
  assert.equal(JSON.stringify(result).includes("nestedSecret"), false);
  assert.equal(JSON.stringify(result).includes("providerMeta"), false);
});

test("projects XMLStock request quota, balance and usage without raw metadata", async () => {
  const crypto = testCrypto();
  const credential = credentialRecord(crypto, createInput, {
    provider: "XMLSTOCK",
    providerMeta: {
      account: {
        requestLimit: 900,
        frozenRequestLimit: 20,
        usedToday: 7,
        usedMonth: 81,
        balance: "27.39",
        frozenBalance: "1.50",
        tariffDaysRemaining: 12,
        rawAccountSecret: "must-not-cross-boundary"
      }
    },
    lastSuccessAt: new Date("2026-08-04T12:00:00.000Z")
  });
  const prisma = {
    integrationCredential: { findMany: async () => [credential] },
    job: { findMany: async () => [] }
  } as unknown as PrismaService;

  const result = await new IntegrationCredentialService(prisma, crypto).list(
    workspaceId
  );

  assert.deepEqual(result[0]?.quota, {
    status: "AVAILABLE",
    unit: "XMLSTOCK_REQUESTS",
    remaining: 900,
    balance: { amount: "27.39", frozenAmount: "1.50", currency: "RUB" },
    frozenRemaining: 20,
    usedToday: 7,
    usedMonth: 81,
    tariffDaysRemaining: 12,
    observedAt: "2026-08-04T12:00:00.000Z"
  });
  assert.equal(JSON.stringify(result).includes("rawAccountSecret"), false);
});

test("fails closed for an active validation projection from another material version", async () => {
  const crypto = testCrypto();
  const credential = credentialRecord(crypto, createInput, {
    materialVersion: 3
  });
  const prisma = {
    integrationCredential: {
      findMany: async () => [credential]
    },
    job: {
      findMany: async () => [
        validationJobRecord({
          deduplicationKey:
            integrationCredentialValidationDeduplicationKey(
              credentialId,
              3
            ),
          inputSnapshot: {
            kind: INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
            credentialId,
            credentialMaterialVersion: 2,
            connectorVersion: "xmlstock@1.1.0"
          }
        })
      ]
    }
  } as unknown as PrismaService;

  await assert.rejects(
    new IntegrationCredentialService(prisma, crypto).list(workspaceId),
    /Invalid active credential validation projection/
  );
});

test("creates one masked credential for an idempotent request", async () => {
  const crypto = testCrypto();
  let stored: IntegrationCredential | null = null;
  let createCount = 0;
  const prisma = {
    integrationCredential: {
      findUnique: async () => stored,
      create: async ({
        data
      }: {
        data: Readonly<Record<string, unknown>>;
      }) => {
        createCount += 1;
        stored = credentialRecord(crypto, createInput, {
          id: String(data.id),
          ciphertext: bytes(data.ciphertext),
          nonce: bytes(data.nonce),
          authTag: bytes(data.authTag),
          encryptedDataKey: bytes(data.encryptedDataKey),
          dataKeyNonce: bytes(data.dataKeyNonce),
          dataKeyAuthTag: bytes(data.dataKeyAuthTag),
          requestFingerprint: bytes(data.requestFingerprint),
          keyVersion: Number(data.keyVersion),
          fingerprintKeyVersion: Number(data.fingerprintKeyVersion)
        });
        return stored;
      }
    }
  } as unknown as PrismaService;
  const service = new IntegrationCredentialService(prisma, crypto);

  const first = await service.create(createInput);
  const replay = await service.create(createInput);

  assert.equal(createCount, 1);
  assert.equal(replay.id, first.id);
  assert.equal(first.displayHint, "••••-key");
  assert.equal("apiKey" in first, false);
  const persisted = stored as IntegrationCredential | null;
  if (!persisted) throw new Error("Credential was not stored");
  stored = { ...persisted, label: "Renamed after create" };
  assert.equal(
    (await service.create(createInput)).label,
    "Renamed after create"
  );
  await assert.rejects(
    service.create({ ...createInput, apiKey: "another-secret-key" }),
    ConflictException
  );
});

test("enables one encrypted platform credential without exposing shared quota", async () => {
  const crypto = testRotatingFingerprintCrypto();
  const executor = testExecutionCrypto();
  let stored: IntegrationCredential | null = null;
  let createCount = 0;
  let activeLookup: unknown;
  const prisma = {
    integrationCredential: {
      findUnique: async ({ where }: { where: {
        workspaceId_idempotencyKey: {
          workspaceId: string;
          idempotencyKey: string;
        };
      } }) =>
        stored?.idempotencyKey ===
        where.workspaceId_idempotencyKey.idempotencyKey
          ? stored
          : null,
      findFirst: async ({ where }: { where: unknown }) => {
        activeLookup = where;
        return stored;
      },
      create: async ({
        data
      }: {
        data: Readonly<Record<string, unknown>>;
      }) => {
        createCount += 1;
        assert.deepEqual(data.providerMeta, {
          accountIdentifierConfigured: true,
          platformPoolSize: 2,
          platformAccountIds: crypto.platformCredentialPoolSecret("XMLSTOCK", platformMaterial).platformPool!.map(entry => entry.id)
        });
        stored = credentialRecord(
          crypto,
          {
            ...createInput,
            idempotencyKey: platformInput.idempotencyKey,
            label: "XMLStock — внутренние токены",
            apiKey: platformMaterial[0].apiKey,
            accountIdentifier: platformMaterial[0].accountIdentifier
          },
          {
            id: String(data.id),
            label: String(data.label),
            mode: "PLATFORM_PAID",
            displayHint: String(data.displayHint),
            capabilities: data.capabilities as string[],
            ciphertext: bytes(data.ciphertext),
            nonce: bytes(data.nonce),
            authTag: bytes(data.authTag),
            encryptedDataKey: bytes(data.encryptedDataKey),
            dataKeyNonce: bytes(data.dataKeyNonce),
            dataKeyAuthTag: bytes(data.dataKeyAuthTag),
            requestFingerprint: bytes(data.requestFingerprint),
            keyVersion: Number(data.keyVersion),
            fingerprintKeyVersion: Number(data.fingerprintKeyVersion),
            providerMeta: {
              account: { balance: "999999.99", requestLimit: 999_999 }
            },
            lastSuccessAt: new Date("2026-08-27T12:00:00.000Z")
          }
        );
        return stored;
      }
    }
  } as unknown as PrismaService;
  const service = new IntegrationCredentialService(prisma, crypto);

  const first = await service.enablePlatform(platformInput, platformMaterial);
  const replay = await service.enablePlatform(platformInput, platformMaterial);

  assert.equal(createCount, 1);
  assert.equal(replay.id, first.id);
  assert.equal(first.mode, "PLATFORM_PAID");
  assert.equal(first.displayHint, "Системный");
  assert.deepEqual(first.capabilities, ["SERP_RANK_TRACKING", "SERP_COLLECTION", "WORDSTAT", "KEYWORD_RESEARCH"]);
  assert.deepEqual(first.quota, { status: "NOT_AVAILABLE" });
  assert.deepEqual(activeLookup, {
    workspaceId,
    provider: "XMLSTOCK",
    mode: "PLATFORM_PAID",
    deletedAt: null
  });
  const persisted = stored as IntegrationCredential | null;
  if (!persisted) throw new Error("Platform credential was not stored");
  assert.equal(persisted.fingerprintKeyVersion, 4);
  const decrypted = executor.decrypt(workspaceId, "XMLSTOCK", persisted.id, {
      ciphertext: Buffer.from(persisted.ciphertext),
      nonce: Buffer.from(persisted.nonce),
      authTag: Buffer.from(persisted.authTag),
      encryptedDataKey: Buffer.from(persisted.encryptedDataKey),
      dataKeyNonce: Buffer.from(persisted.dataKeyNonce),
      dataKeyAuthTag: Buffer.from(persisted.dataKeyAuthTag),
      keyVersion: persisted.keyVersion
    });
  assert.equal(decrypted.apiKey, platformMaterial[0].apiKey);
  assert.equal(decrypted.platformPool?.length, 2);
  assert.deepEqual(
    decrypted.platformPool?.map(({ apiKey, accountIdentifier }) => ({
      apiKey,
      accountIdentifier
    })),
    platformMaterial
  );
  assert.equal(
    decrypted.rateLimitScopeId,
    decrypted.platformPool?.[0]?.id
  );
  assert.match(decrypted.rateLimitScopeId ?? "", /^[0-9a-f-]{36}$/u);

  await assert.rejects(
    service.enablePlatform(
      { ...platformInput, idempotencyKey: "platform-credential-enable-002" },
      platformMaterial
    ),
    ConflictException
  );
});

test("does not replay a platform credential through the BYOK create boundary", async () => {
  const crypto = testCrypto();
  const platform = credentialRecord(crypto, createInput, {
    mode: "PLATFORM_PAID"
  });
  const prisma = {
    integrationCredential: { findUnique: async () => platform }
  } as unknown as PrismaService;

  await assert.rejects(
    new IntegrationCredentialService(prisma, crypto).create(createInput),
    ConflictException
  );
});

test("prevents workspace users from editing a platform-owned secret", async () => {
  const crypto = testCrypto();
  let updateCalls = 0;
  const platform = credentialRecord(crypto, createInput, {
    mode: "PLATFORM_PAID"
  });
  const prisma = {
    integrationCredential: {
      findFirst: async () => platform,
      update: async () => {
        updateCalls += 1;
        return platform;
      }
    }
  } as unknown as PrismaService;

  await assert.rejects(
    new IntegrationCredentialService(prisma, crypto).update(credentialId, {
      workspaceId,
      actorId,
      version: 1,
      label: "Подмена системного ключа",
      apiKey: "attacker-owned-key"
    }),
    UnprocessableEntityException
  );
  assert.equal(updateCalls, 0);
});

test("returns the concurrent create winner after a matching P2002 race", async () => {
  const crypto = testCrypto();
  const winner = credentialRecord(crypto, createInput);
  let lookupCount = 0;
  const prisma = {
    integrationCredential: {
      findUnique: async () => {
        lookupCount += 1;
        return lookupCount === 1 ? null : winner;
      },
      create: async () => {
        throw { code: "P2002" };
      }
    }
  } as unknown as PrismaService;

  const result = await new IntegrationCredentialService(
    prisma,
    crypto
  ).create(createInput);

  assert.equal(result.id, winner.id);
  assert.equal(lookupCount, 2);
});

test("rejects a P2002 winner created with a different payload", async () => {
  const crypto = testCrypto();
  const winner = credentialRecord(crypto, {
    ...createInput,
    apiKey: "different-api-key"
  });
  let lookupCount = 0;
  const prisma = {
    integrationCredential: {
      findUnique: async () => {
        lookupCount += 1;
        return lookupCount === 1 ? null : winner;
      },
      create: async () => {
        throw { code: "P2002" };
      }
    }
  } as unknown as PrismaService;

  await assert.rejects(
    new IntegrationCredentialService(prisma, crypto).create(createInput),
    ConflictException
  );
});

test("rotates only a complete replacement secret and uses optimistic locking", async () => {
  const crypto = testCrypto();
  const executor = testExecutionCrypto();
  let state = credentialRecord(crypto, createInput);
  const originalFingerprint = state.requestFingerprint;
  let updateWhere: Readonly<Record<string, unknown>> | undefined;
  const prisma = {
    integrationCredential: {
      findFirst: async () => state,
      update: async ({
        where,
        data
      }: {
        where: Readonly<Record<string, unknown>>;
        data: Readonly<Record<string, unknown>>;
      }) => {
        updateWhere = where;
        state = {
          ...state,
          label: String(data.label),
          ciphertext: bytes(data.ciphertext),
          nonce: bytes(data.nonce),
          authTag: bytes(data.authTag),
          encryptedDataKey: bytes(data.encryptedDataKey),
          dataKeyNonce: bytes(data.dataKeyNonce),
          dataKeyAuthTag: bytes(data.dataKeyAuthTag),
          keyVersion: Number(data.keyVersion),
          status: "PENDING_VERIFICATION",
          materialVersion: state.materialVersion + 1,
          lastErrorCode: null,
          version: state.version + 1,
          updatedAt: new Date()
        };
        return state;
      }
    }
  } as unknown as PrismaService;
  const service = new IntegrationCredentialService(prisma, crypto);

  await assert.rejects(
    service.update(credentialId, {
      workspaceId,
      actorId,
      version: 1,
      label: "Primary",
      accountIdentifier: "account-2"
    }),
    UnprocessableEntityException
  );
  const result = await service.update(credentialId, {
    workspaceId,
    actorId,
    version: 1,
    label: "Rotated",
    apiKey: "replacement-api-key",
    accountIdentifier: "account-2"
  });

  assert.deepEqual(updateWhere, {
    id: credentialId,
    workspaceId,
    deletedAt: null,
    version: 1
  });
  assert.equal(result.version, 2);
  assert.equal(state.materialVersion, 2);
  assert.deepEqual(state.requestFingerprint, originalFingerprint);
  assert.deepEqual(
    executor.decrypt(workspaceId, "XMLSTOCK", credentialId, {
      ciphertext: Buffer.from(state.ciphertext),
      nonce: Buffer.from(state.nonce),
      authTag: Buffer.from(state.authTag),
      encryptedDataKey: Buffer.from(state.encryptedDataKey),
      dataKeyNonce: Buffer.from(state.dataKeyNonce),
      dataKeyAuthTag: Buffer.from(state.dataKeyAuthTag),
      keyVersion: state.keyVersion
    }),
    {
      apiKey: "replacement-api-key",
      accountIdentifier: "account-2"
    }
  );
});

test("destroys encrypted material on a tenant-scoped revoke", async () => {
  const crypto = testCrypto();
  const current = credentialRecord(crypto, createInput);
  let lookup: unknown;
  let update: {
    readonly where: Readonly<Record<string, unknown>>;
    readonly data: Readonly<Record<string, unknown>>;
  } | undefined;
  const prisma = {
    integrationCredential: {
      findFirst: async ({ where }: { where: unknown }) => {
        lookup = where;
        return current;
      },
      update: async (input: typeof update) => {
        update = input;
        return current;
      }
    }
  } as unknown as PrismaService;
  const service = new IntegrationCredentialService(prisma, crypto);

  await service.revoke(credentialId, workspaceId, 1, actorId);

  assert.deepEqual(lookup, {
    id: credentialId,
    workspaceId,
    deletedAt: null
  });
  assert.deepEqual(update?.where, {
    id: credentialId,
    workspaceId,
    deletedAt: null,
    version: 1
  });
  assert.equal(update?.data.status, "REVOKED");
  assert.ok(update?.data.deletedAt instanceof Date);
  assert.equal(update?.data.displayHint, null);
  assert.deepEqual(update?.data.materialVersion, { increment: 1 });
  assert.notDeepEqual(
    bytes(update?.data.ciphertext),
    current.ciphertext
  );
  assert.notDeepEqual(
    bytes(update?.data.requestFingerprint),
    current.requestFingerprint
  );
});

test("keeps secret material version stable for a label-only update", async () => {
  const crypto = testCrypto();
  const current = credentialRecord(crypto, createInput);
  let updateData: Readonly<Record<string, unknown>> | undefined;
  const prisma = {
    integrationCredential: {
      findFirst: async () => current,
      update: async ({
        data
      }: {
        readonly data: Readonly<Record<string, unknown>>;
      }) => {
        updateData = data;
        return {
          ...current,
          label: String(data.label),
          version: current.version + 1
        };
      }
    }
  } as unknown as PrismaService;

  await new IntegrationCredentialService(prisma, crypto).update(
    credentialId,
    {
      workspaceId,
      actorId,
      version: 1,
      label: "Renamed"
    }
  );

  assert.equal(updateData?.materialVersion, undefined);
});

test("returns a conflict when a compare-and-swap update loses the race", async () => {
  const crypto = testCrypto();
  const prisma = {
    integrationCredential: {
      findFirst: async () => credentialRecord(crypto, createInput),
      update: async () => {
        throw { code: "P2025" };
      }
    }
  } as unknown as PrismaService;
  const service = new IntegrationCredentialService(prisma, crypto);

  await assert.rejects(
    service.update(credentialId, {
      workspaceId,
      actorId,
      version: 1,
      label: "Concurrent edit"
    }),
    ConflictException
  );
});

function testCrypto(): IntegrationCredentialCryptoService {
  const key = Buffer.alloc(32, 7).toString("base64url");
  const fingerprintKey = Buffer.alloc(32, 8).toString("base64url");
  return new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIALS_ENABLED: "true",
      INTEGRATION_CREDENTIAL_KEYS: `1:${key}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `4:${fingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "4",
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32)
    })
  );
}

function testRotatingFingerprintCrypto(): IntegrationCredentialCryptoService {
  const key = Buffer.alloc(32, 7).toString("base64url");
  const oldFingerprintKey = Buffer.alloc(32, 8).toString("base64url");
  const activeFingerprintKey = Buffer.alloc(32, 9).toString("base64url");
  return new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIALS_ENABLED: "true",
      INTEGRATION_CREDENTIAL_KEYS: `1:${key}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS:
        `4:${oldFingerprintKey},5:${activeFingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "5",
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32)
    })
  );
}

function testExecutionCrypto(): IntegrationCredentialCryptoService {
  const key = Buffer.alloc(32, 7).toString("base64url");
  return new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
      INTEGRATION_CREDENTIAL_KEYS: `1:${key}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
    })
  );
}

function credentialRecord(
  crypto: IntegrationCredentialCryptoService,
  input: InternalCreateIntegrationCredentialInput,
  overrides: Partial<IntegrationCredential> = {}
): IntegrationCredential {
  const encrypted = crypto.encrypt(
    input.workspaceId,
    input.provider,
    credentialId,
    {
      apiKey: input.apiKey,
      ...(input.accountIdentifier
        ? { accountIdentifier: input.accountIdentifier }
        : {})
    }
  );
  const requestFingerprint = crypto.requestFingerprint({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
    provider: input.provider,
    label: input.label,
    apiKey: input.apiKey,
    ...(input.accountIdentifier
      ? { accountIdentifier: input.accountIdentifier }
      : {})
  });
  const now = new Date("2026-07-29T09:00:00.000Z");
  return {
    id: credentialId,
    workspaceId: input.workspaceId,
    provider: input.provider,
    label: input.label,
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
    providerMeta: { accountIdentifierConfigured: true },
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: Uint8Array.from(requestFingerprint.digest),
    fingerprintKeyVersion: requestFingerprint.keyVersion,
    materialVersion: 1,
    createdBy: input.actorId,
    updatedBy: input.actorId,
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

function validationJobRecord(overrides: Partial<Job> = {}): Job {
  const now = new Date("2026-07-29T09:00:00.000Z");
  return {
    billingQuoteId: null, billingCommandHash: null, billingMaximumUnitsMilli: null,
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
      integrationCredentialValidationDeduplicationKey(credentialId, 1),
    idempotencyScope:
      integrationCredentialValidationScope(credentialId),
    idempotencyKey: "credential-validation-001",
    requestHash: null,
    inputSnapshot: {
      kind: INTEGRATION_CREDENTIAL_VALIDATION_INPUT_KIND,
      credentialId,
      credentialMaterialVersion: 1,
      connectorVersion: "xmlstock@1.1.0"
    },
    scopeSnapshot: { workspaceId, credentialId },
    progressCurrent: 0n,
    progressTotal: 1n,
    progressUnit: "credential",
    estimatedCostMicro: 0n,
    reservedCostMicro: null,
    actualCostMicro: null,
    currency: null,
    credentialMode: "BYOK_API_KEY",
    provider: "XMLSTOCK",
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

function bytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new Error("Expected bytes");
  }
  return Uint8Array.from(value);
}
