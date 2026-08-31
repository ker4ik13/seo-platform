import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const credentialId = "01900000-0000-7000-8000-000000000002";
const fingerprintKey = Buffer.alloc(32, 9).toString("base64url");
const credentialApiToken = "c".repeat(32);

test("encrypts and authenticates integration secrets with workspace AAD", () => {
  const key = Buffer.alloc(32, 7).toString("base64url");
  const manager = managementCrypto(`3:${key}`, 3);
  const executor = executionCrypto(`3:${key}`, 3);
  const encrypted = manager.encrypt(
    workspaceId,
    "XMLSTOCK",
    credentialId,
    {
      apiKey: "secret-api-key",
      accountIdentifier: "12345"
    }
  );

  assert.equal(encrypted.keyVersion, 3);
  assert.equal(
    encrypted.ciphertext.includes(Buffer.from("secret-api-key")),
    false
  );
  assert.deepEqual(
    executor.decrypt(workspaceId, "XMLSTOCK", credentialId, encrypted),
    {
      apiKey: "secret-api-key",
      accountIdentifier: "12345"
    }
  );
  assert.throws(
    () =>
      manager.decrypt(
        workspaceId,
        "XMLSTOCK",
        credentialId,
        encrypted
      ),
    ServiceUnavailableException
  );
  assert.throws(
    () =>
      executor.decrypt(
        "01900000-0000-7000-8000-000000000002",
        "XMLSTOCK",
        credentialId,
        encrypted
      ),
    ServiceUnavailableException
  );
  assert.throws(
    () =>
      executor.decrypt(
        workspaceId,
        "XMLSTOCK",
        "01900000-0000-7000-8000-000000000003",
        encrypted
      ),
    ServiceUnavailableException
  );
});

test("rejects tampered payloads and wrapped data keys", () => {
  const key = Buffer.alloc(32, 7).toString("base64url");
  const manager = managementCrypto(`3:${key}`, 3);
  const executor = executionCrypto(`3:${key}`, 3);
  const encrypted = manager.encrypt(
    workspaceId,
    "KEYS_SO",
    credentialId,
    { apiKey: "secret-api-key" }
  );
  const tamperedPayload = Buffer.from(encrypted.ciphertext);
  tamperedPayload[0] = (tamperedPayload[0] ?? 0) ^ 1;
  const tamperedDataKey = Buffer.from(encrypted.encryptedDataKey);
  tamperedDataKey[0] = (tamperedDataKey[0] ?? 0) ^ 1;

  assert.throws(
    () =>
      executor.decrypt(workspaceId, "KEYS_SO", credentialId, {
        ...encrypted,
        ciphertext: tamperedPayload
      }),
    ServiceUnavailableException
  );
  assert.throws(
    () =>
      executor.decrypt(workspaceId, "KEYS_SO", credentialId, {
        ...encrypted,
        encryptedDataKey: tamperedDataKey
      }),
    ServiceUnavailableException
  );
});

test("keeps old credentials readable during an overlapping key rotation", () => {
  const first = Buffer.alloc(32, 1).toString("base64url");
  const second = Buffer.alloc(32, 2).toString("base64url");
  const beforeRotation = managementCrypto(`1:${first}`, 1);
  const oldCredential = beforeRotation.encrypt(
    workspaceId,
    "ARSENKIN",
    credentialId,
    { apiKey: "secret-api-key" }
  );
  const duringRotation = managementCrypto(
    `1:${first},2:${second}`,
    2
  );
  const rotationExecutor = executionCrypto(
    `1:${first},2:${second}`,
    2
  );

  assert.deepEqual(
    rotationExecutor.decrypt(
      workspaceId,
      "ARSENKIN",
      credentialId,
      oldCredential
    ),
    { apiKey: "secret-api-key" }
  );
  assert.equal(
    duringRotation.encrypt(
      workspaceId,
      "ARSENKIN",
      "01900000-0000-7000-8000-000000000003",
      { apiKey: "next-secret-key" }
    ).keyVersion,
    2
  );
});

test("encrypts a bounded platform pool with stable opaque entry scopes", () => {
  const key = Buffer.alloc(32, 7).toString("base64url");
  const manager = managementCrypto(`3:${key}`, 3);
  const executor = executionCrypto(`3:${key}`, 3);
  const material = [
    { apiKey: "arsenkin-secret-one" },
    { apiKey: "arsenkin-secret-two" }
  ] as const;
  const first = manager.platformCredentialPoolSecret("ARSENKIN", material);
  const second = manager.platformCredentialPoolSecret("ARSENKIN", [
    ...material
  ].reverse());
  const rotatedFingerprintManager = managementCryptoWithFingerprintKeyring(
    `8:${fingerprintKey},9:${Buffer.alloc(32, 10).toString("base64url")}`,
    9
  );
  const afterFingerprintRotation =
    rotatedFingerprintManager.platformCredentialPoolSecret(
      "ARSENKIN",
      material
    );

  assert.equal(
    rotatedFingerprintManager.platformCredentialFingerprintKeyVersion(),
    8
  );
  assert.equal(first.platformPool?.length, 2);
  assert.equal(
    first.platformPool?.[0]?.id,
    second.platformPool?.[1]?.id
  );
  assert.equal(
    first.platformPool?.[0]?.id,
    afterFingerprintRotation.platformPool?.[0]?.id
  );
  assert.match(first.rateLimitScopeId ?? "", /^[0-9a-f-]{36}$/u);
  assert.equal(
    JSON.stringify(first).includes("platform-provider-pool-entry"),
    false
  );

  const encrypted = manager.encrypt(
    workspaceId,
    "ARSENKIN",
    credentialId,
    first
  );
  assert.deepEqual(
    executor.decrypt(workspaceId, "ARSENKIN", credentialId, encrypted),
    first
  );
});

test("keeps the legacy BYOK request fingerprint byte-compatible", () => {
  const manager = managementCrypto(
    `3:${Buffer.alloc(32, 7).toString("base64url")}`,
    3
  );
  const input = {
    workspaceId,
    actorId: "01900000-0000-7000-8000-000000000004",
    idempotencyKey: "credential-create-001",
    provider: "XMLSTOCK" as const,
    label: "Primary",
    apiKey: "secret-api-key",
    accountIdentifier: "12345"
  };
  const expected = createHmac(
    "sha256",
    Buffer.from(fingerprintKey, "base64url")
  )
    .update("seo-platform:integration-credential-request:v1", "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      provider: input.provider,
      label: input.label,
      apiKey: input.apiKey,
      accountIdentifier: input.accountIdentifier
    }), "utf8")
    .digest();

  assert.deepEqual(manager.requestFingerprint(input).digest, expected);
});

test("fails closed when credential encryption is not configured", () => {
  const crypto = new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test"
    })
  );
  assert.throws(
    () =>
      crypto.encrypt(workspaceId, "KEYS_SO", credentialId, {
        apiKey: "secret-api-key"
      }),
    ServiceUnavailableException
  );
});

test("lets an execution worker decrypt but not create credential material", () => {
  const key = Buffer.alloc(32, 7).toString("base64url");
  const manager = managementCrypto(`3:${key}`, 3);
  const encrypted = manager.encrypt(
    workspaceId,
    "KEYS_SO",
    credentialId,
    { apiKey: "secret-api-key" }
  );
  const executor = executionCrypto(`3:${key}`, 3);

  assert.deepEqual(
    executor.decrypt(workspaceId, "KEYS_SO", credentialId, encrypted),
    { apiKey: "secret-api-key" }
  );
  assert.throws(
    () =>
      executor.encrypt(workspaceId, "KEYS_SO", credentialId, {
        apiKey: "another-secret"
      }),
    ServiceUnavailableException
  );
});

function managementCrypto(
  keyring: string,
  activeKeyVersion: number
): IntegrationCredentialCryptoService {
  return new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIAL_ROLE: "MANAGEMENT",
      INTEGRATION_CREDENTIAL_KEYS: keyring,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: String(activeKeyVersion),
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `8:${fingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "8",
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
    })
  );
}

function managementCryptoWithFingerprintKeyring(
  fingerprintKeyring: string,
  activeFingerprintKeyVersion: number
): IntegrationCredentialCryptoService {
  const key = Buffer.alloc(32, 7).toString("base64url");
  return new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIAL_ROLE: "MANAGEMENT",
      INTEGRATION_CREDENTIAL_KEYS: `3:${key}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "3",
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: fingerprintKeyring,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: String(
        activeFingerprintKeyVersion
      ),
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
    })
  );
}

function executionCrypto(
  keyring: string,
  activeKeyVersion: number
): IntegrationCredentialCryptoService {
  return new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
      INTEGRATION_CREDENTIAL_KEYS: keyring,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: String(activeKeyVersion)
    })
  );
}
