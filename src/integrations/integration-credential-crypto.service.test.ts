import assert from "node:assert/strict";
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
  const crypto = new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIALS_ENABLED: "true",
      INTEGRATION_CREDENTIAL_KEYS: `3:${key}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "3",
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `8:${fingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "8",
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
    })
  );
  const encrypted = crypto.encrypt(workspaceId, "XMLSTOCK", credentialId, {
    apiKey: "secret-api-key",
    accountIdentifier: "12345"
  });

  assert.equal(encrypted.keyVersion, 3);
  assert.equal(
    encrypted.ciphertext.includes(Buffer.from("secret-api-key")),
    false
  );
  assert.deepEqual(
    crypto.decrypt(workspaceId, "XMLSTOCK", credentialId, encrypted),
    {
      apiKey: "secret-api-key",
      accountIdentifier: "12345"
    }
  );
  assert.throws(
    () =>
      crypto.decrypt(
        "01900000-0000-7000-8000-000000000002",
        "XMLSTOCK",
        credentialId,
        encrypted
      ),
    ServiceUnavailableException
  );
  assert.throws(
    () =>
      crypto.decrypt(
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
  const crypto = new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIALS_ENABLED: "true",
      INTEGRATION_CREDENTIAL_KEYS: `3:${key}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "3",
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `8:${fingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "8",
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
    })
  );
  const encrypted = crypto.encrypt(
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
      crypto.decrypt(workspaceId, "KEYS_SO", credentialId, {
        ...encrypted,
        ciphertext: tamperedPayload
      }),
    ServiceUnavailableException
  );
  assert.throws(
    () =>
      crypto.decrypt(workspaceId, "KEYS_SO", credentialId, {
        ...encrypted,
        encryptedDataKey: tamperedDataKey
      }),
    ServiceUnavailableException
  );
});

test("keeps old credentials readable during an overlapping key rotation", () => {
  const first = Buffer.alloc(32, 1).toString("base64url");
  const second = Buffer.alloc(32, 2).toString("base64url");
  const beforeRotation = new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIALS_ENABLED: "true",
      INTEGRATION_CREDENTIAL_KEYS: `1:${first}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `8:${fingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "8",
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
    })
  );
  const oldCredential = beforeRotation.encrypt(
    workspaceId,
    "ARSENKIN",
    credentialId,
    { apiKey: "secret-api-key" }
  );
  const duringRotation = new IntegrationCredentialCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTEGRATION_CREDENTIALS_ENABLED: "true",
      INTEGRATION_CREDENTIAL_KEYS: `1:${first},2:${second}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "2",
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `8:${fingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "8",
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
    })
  );

  assert.deepEqual(
    duringRotation.decrypt(
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
