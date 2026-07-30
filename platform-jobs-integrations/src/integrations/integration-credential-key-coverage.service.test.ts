import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import { loadAppConfig } from "../config/app-config.js";
import {
  type EncryptedIntegrationCredential,
  IntegrationCredentialCryptoService
} from "./integration-credential-crypto.service.js";
import {
  IntegrationCredentialKeyCoverageService,
  missingKeyVersions
} from "./integration-credential-key-coverage.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const fingerprintKey = Buffer.alloc(32, 4).toString("base64url");
const credentialApiToken = "c".repeat(32);

test("reports every credential key version missing from the keyring", () => {
  const keys = new Map([[2, Buffer.alloc(32)]]);

  assert.deepEqual(missingKeyVersions([3, 1, 3, 2], keys), [1, 3]);
});

test("fails startup before serving credentials with an incomplete keyring", async () => {
  const key = Buffer.alloc(32, 2).toString("base64url");
  const prisma = {
    integrationCredential: {
      groupBy: async ({
        by
      }: {
        readonly by: readonly string[];
      }) =>
        by[0] === "keyVersion"
          ? [{ keyVersion: 1 }, { keyVersion: 2 }]
          : [{ fingerprintKeyVersion: 4 }]
    }
  } as unknown as PrismaService;
  const config = managementConfig(`2:${key}`, 2);
  const service = new IntegrationCredentialKeyCoverageService(
    prisma,
    new IntegrationCredentialCryptoService(config),
    config
  );

  await assert.rejects(
    service.onModuleInit(),
    /encryption versions: 1/u
  );
});

test("management verifies both keyring versions without decrypting", async () => {
  const key = Buffer.alloc(32, 2).toString("base64url");
  const requestedGroups: string[] = [];
  let sampleQueries = 0;
  const prisma = {
    integrationCredential: {
      groupBy: async ({
        by
      }: {
        readonly by: readonly string[];
      }) => {
        requestedGroups.push(String(by[0]));
        return by[0] === "keyVersion"
          ? [{ keyVersion: 2 }]
          : [{ fingerprintKeyVersion: 4 }];
      },
      findFirst: async () => {
        sampleQueries += 1;
        throw new Error("Management must not read encrypted canary material");
      }
    }
  } as unknown as PrismaService;
  const config = managementConfig(`2:${key}`, 2);
  const service = new IntegrationCredentialKeyCoverageService(
    prisma,
    new IntegrationCredentialCryptoService(config),
    config
  );

  await service.onModuleInit();

  assert.deepEqual(requestedGroups, [
    "keyVersion",
    "fingerprintKeyVersion"
  ]);
  assert.equal(sampleQueries, 0);
});

test("execution decrypts one deterministic non-deleted sample for every used key version", async () => {
  const firstKey = Buffer.alloc(32, 2).toString("base64url");
  const secondKey = Buffer.alloc(32, 6).toString("base64url");
  const keyring = `2:${firstKey},6:${secondKey}`;
  const firstId = "01900000-0000-7000-8000-000000000002";
  const secondId = "01900000-0000-7000-8000-000000000006";
  const samples = new Map([
    [
      2,
      encryptedSample(
        keyring,
        2,
        firstId,
        "ARSENKIN",
        "canary-secret-first"
      )
    ],
    [
      6,
      encryptedSample(
        keyring,
        6,
        secondId,
        "KEYS_SO",
        "canary-secret-second"
      )
    ]
  ]);
  const sampleQueries: number[] = [];
  const prisma = {
    integrationCredential: {
      groupBy: async () => [
        { keyVersion: 6 },
        { keyVersion: 2 }
      ],
      findFirst: async (query: {
        readonly where: {
          readonly keyVersion: number;
          readonly deletedAt: null;
        };
        readonly orderBy: { readonly id: "asc" };
      }) => {
        assert.equal(query.where.deletedAt, null);
        assert.deepEqual(query.orderBy, { id: "asc" });
        sampleQueries.push(query.where.keyVersion);
        return samples.get(query.where.keyVersion) ?? null;
      }
    }
  } as unknown as PrismaService;
  const config = executionConfig(keyring, 6);
  const service = new IntegrationCredentialKeyCoverageService(
    prisma,
    new IntegrationCredentialCryptoService(config),
    config
  );

  await service.onModuleInit();

  assert.deepEqual(sampleQueries, [2, 6]);
});

test("execution allows an empty credential database without a canary sample", async () => {
  const key = Buffer.alloc(32, 2).toString("base64url");
  let sampleQueries = 0;
  const prisma = {
    integrationCredential: {
      groupBy: async () => [],
      findFirst: async () => {
        sampleQueries += 1;
        return null;
      }
    }
  } as unknown as PrismaService;
  const config = executionConfig(`2:${key}`, 2);
  const service = new IntegrationCredentialKeyCoverageService(
    prisma,
    new IntegrationCredentialCryptoService(config),
    config
  );

  await service.onModuleInit();

  assert.equal(sampleQueries, 0);
});

test("execution fails closed on a corrupt canary without exposing row data", async () => {
  const key = Buffer.alloc(32, 2).toString("base64url");
  const keyring = `2:${key}`;
  const credentialId = "01900000-0000-7000-8000-000000000002";
  const secret = "never-log-this-canary-secret";
  const valid = encryptedSample(
    keyring,
    2,
    credentialId,
    "ARSENKIN",
    secret
  );
  const corrupt = {
    ...valid,
    authTag: Buffer.alloc(valid.authTag.length)
  };
  const prisma = {
    integrationCredential: {
      groupBy: async () => [{ keyVersion: 2 }],
      findFirst: async () => corrupt
    }
  } as unknown as PrismaService;
  const config = executionConfig(keyring, 2);
  const service = new IntegrationCredentialKeyCoverageService(
    prisma,
    new IntegrationCredentialCryptoService(config),
    config
  );

  await assert.rejects(service.onModuleInit(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(
      error.message,
      "Integration credential decrypt canary failed for encryption versions: 2"
    );
    assert.equal(error.message.includes(credentialId), false);
    assert.equal(error.message.includes("ARSENKIN"), false);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test("execution fails closed when a used key version has no readable sample", async () => {
  const key = Buffer.alloc(32, 2).toString("base64url");
  const prisma = {
    integrationCredential: {
      groupBy: async () => [{ keyVersion: 2 }],
      findFirst: async () => null
    }
  } as unknown as PrismaService;
  const config = executionConfig(`2:${key}`, 2);
  const service = new IntegrationCredentialKeyCoverageService(
    prisma,
    new IntegrationCredentialCryptoService(config),
    config
  );

  await assert.rejects(
    service.onModuleInit(),
    /decrypt canary failed for encryption versions: 2/u
  );
});

function encryptedSample(
  keyring: string,
  activeKeyVersion: number,
  credentialId: string,
  provider: "ARSENKIN" | "KEYS_SO",
  apiKey: string
): EncryptedIntegrationCredential & {
  readonly id: string;
  readonly workspaceId: string;
  readonly provider: "ARSENKIN" | "KEYS_SO";
} {
  const config = managementConfig(keyring, activeKeyVersion);
  const encrypted = new IntegrationCredentialCryptoService(config).encrypt(
    workspaceId,
    provider,
    credentialId,
    { apiKey }
  );
  return {
    id: credentialId,
    workspaceId,
    provider,
    ...encrypted
  };
}

function managementConfig(
  keyring: string,
  activeKeyVersion: number
): AppConfig {
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIAL_ROLE: "MANAGEMENT",
    INTEGRATION_CREDENTIAL_KEYS: keyring,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: String(activeKeyVersion),
    INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `4:${fingerprintKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "4",
    PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
  });
}

function executionConfig(
  keyring: string,
  activeKeyVersion: number
): AppConfig {
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
    INTEGRATION_CREDENTIAL_KEYS: keyring,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: String(activeKeyVersion)
  });
}
