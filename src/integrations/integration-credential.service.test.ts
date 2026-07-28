import assert from "node:assert/strict";
import test from "node:test";
import {
  ConflictException,
  UnprocessableEntityException
} from "@nestjs/common";
import type { InternalCreateIntegrationCredentialInput } from "@seo-platform/contracts";
import { loadAppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { IntegrationCredential } from "../generated/prisma/client.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";
import { internalCreateIntegrationCredentialInput } from "./integration-credential-input.js";
import { IntegrationCredentialService } from "./integration-credential.service.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const actorId = "0190abcd-0000-7000-8000-0000000000a2";
const credentialId = "0190abcd-0000-7000-8000-0000000000b3";
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
  assert.deepEqual(state.requestFingerprint, originalFingerprint);
  assert.deepEqual(
    crypto.decrypt(workspaceId, "XMLSTOCK", credentialId, {
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
  assert.notDeepEqual(
    bytes(update?.data.ciphertext),
    current.ciphertext
  );
  assert.notDeepEqual(
    bytes(update?.data.requestFingerprint),
    current.requestFingerprint
  );
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
    createdBy: input.actorId,
    updatedBy: input.actorId,
    verifiedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides
  };
}

function bytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new Error("Expected bytes");
  }
  return Uint8Array.from(value);
}
