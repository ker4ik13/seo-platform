import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import { loadAppConfig } from "../config/app-config.js";
import type {
  IntegrationCredentialExecutionBrokerService,
  IntegrationCredentialKekCanaryRecord
} from "./integration-credential-execution-broker.service.js";
import {
  IntegrationCredentialCryptoService,
  type EncryptedIntegrationCredential
} from "./integration-credential-crypto.service.js";
import {
  IntegrationCredentialKeyCoverageService,
  missingKeyVersions
} from "./integration-credential-key-coverage.service.js";

const fingerprintKey = Buffer.alloc(32, 4).toString("base64url");
const credentialApiToken = "c".repeat(32);

test("reports every credential key version missing from the keyring", () => {
  const keys = new Map([[2, Buffer.alloc(32)]]);

  assert.deepEqual(missingKeyVersions([3, 1, 3, 2], keys), [1, 3]);
});

test("management fails startup when stored key versions are not covered", async () => {
  const config = managementConfig(keyring(2), 2);
  const broker = brokerStub({
    keyVersions: async () => ({
      encryption: [1, 2],
      fingerprint: [4]
    })
  });
  const service = new IntegrationCredentialKeyCoverageService(
    broker,
    new IntegrationCredentialCryptoService(config),
    config
  );

  await assert.rejects(service.onModuleInit(), /encryption versions: 1/u);
});

test("management registers and verifies one synthetic canary per configured KEK", async () => {
  const config = managementConfig(`${keyring(2)},${keyring(6)}`, 6);
  const registered: number[] = [];
  const broker = brokerStub({
    keyVersions: async () => ({ encryption: [2], fingerprint: [4] }),
    registerKekCanary: async (encrypted) => {
      registered.push(encrypted.keyVersion);
      return { keyVersion: encrypted.keyVersion, encrypted };
    }
  });
  const service = new IntegrationCredentialKeyCoverageService(
    broker,
    new IntegrationCredentialCryptoService(config),
    config
  );

  await service.onModuleInit();

  assert.deepEqual(registered, [2, 6]);
});

test("execution verifies broker-projected synthetic canaries without tenant rows", async () => {
  const keys = `${keyring(2)},${keyring(6)}`;
  const management = managementConfig(keys, 6);
  const canaries = [2, 6].map((version, index) => ({
    keyVersion: version,
    usedByCredential: index === 0,
    encrypted: new IntegrationCredentialCryptoService(
      management
    ).createKekCanary(version)
  }));
  const config = executionConfig(keys, 6);
  const requested: number[][] = [];
  const broker = brokerStub({
    executionKekCanaries: async (versions) => {
      requested.push([...versions]);
      return canaries;
    }
  });
  const service = new IntegrationCredentialKeyCoverageService(
    broker,
    new IntegrationCredentialCryptoService(config),
    config
  );

  await service.onModuleInit();

  assert.deepEqual(requested, [[2, 6]]);
});

test("execution verifies a configured KEK before any credential uses it", async () => {
  const config = executionConfig(keyring(2), 2);
  const encrypted = new IntegrationCredentialCryptoService(
    managementConfig(keyring(2), 2)
  ).createKekCanary(2);
  const broker = brokerStub({
    executionKekCanaries: async (versions) => {
      assert.deepEqual(versions, [2]);
      return [{ keyVersion: 2, usedByCredential: false, encrypted }];
    }
  });
  const service = new IntegrationCredentialKeyCoverageService(
    broker,
    new IntegrationCredentialCryptoService(config),
    config,
    { attempts: 1, intervalMs: 0 }
  );

  await service.onModuleInit();
});

test("execution waits for management to register a missing canary", async () => {
  const config = executionConfig(keyring(2), 2);
  const encrypted = new IntegrationCredentialCryptoService(
    managementConfig(keyring(2), 2)
  ).createKekCanary(2);
  let reads = 0;
  const broker = brokerStub({
    executionKekCanaries: async () => {
      reads += 1;
      return [{
        keyVersion: 2,
        usedByCredential: false,
        ...(reads > 1 ? { encrypted } : {})
      }];
    }
  });
  const service = new IntegrationCredentialKeyCoverageService(
    broker,
    new IntegrationCredentialCryptoService(config),
    config,
    { attempts: 1, intervalMs: 0 }
  );

  await service.onModuleInit();

  assert.equal(reads, 2);
});

test("execution fails closed when a configured unused version has no canary", async () => {
  const config = executionConfig(keyring(2), 2);
  const broker = brokerStub({
    executionKekCanaries: async () => [
      { keyVersion: 2, usedByCredential: false }
    ]
  });
  const service = new IntegrationCredentialKeyCoverageService(
    broker,
    new IntegrationCredentialCryptoService(config),
    config,
    { attempts: 0, intervalMs: 0 }
  );

  await assert.rejects(
    service.onModuleInit(),
    /decrypt canary failed for encryption versions: 2/u
  );
});

test("execution fails closed when a used version has no canary", async () => {
  const config = executionConfig(keyring(2), 2);
  const broker = brokerStub({
    executionKekCanaries: async () => [
      { keyVersion: 2, usedByCredential: true }
    ]
  });
  const service = new IntegrationCredentialKeyCoverageService(
    broker,
    new IntegrationCredentialCryptoService(config),
    config,
    { attempts: 0, intervalMs: 0 }
  );

  await assert.rejects(
    service.onModuleInit(),
    /decrypt canary failed for encryption versions: 2/u
  );
});

test("execution fails closed when the same version is configured with another KEK", async () => {
  const sourceConfig = managementConfig(keyring(2), 2);
  const encrypted = new IntegrationCredentialCryptoService(
    sourceConfig
  ).createKekCanary(2);
  const wrongConfig = executionConfig(
    `2:${Buffer.alloc(32, 9).toString("base64url")}`,
    2
  );
  const broker = brokerStub({
    executionKekCanaries: async () => [
      { keyVersion: 2, usedByCredential: false, encrypted }
    ]
  });
  const service = new IntegrationCredentialKeyCoverageService(
    broker,
    new IntegrationCredentialCryptoService(wrongConfig),
    wrongConfig
  );

  await assert.rejects(service.onModuleInit(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(
      error.message,
      "Integration credential decrypt canary failed for encryption versions: 2"
    );
    assert.equal(error.message.includes("credential"), true);
    return true;
  });
});

test("execution still rejects a used KEK missing from its keyring", async () => {
  const sourceConfig = managementConfig(keyring(2), 2);
  const encrypted = new IntegrationCredentialCryptoService(
    sourceConfig
  ).createKekCanary(2);
  const config = executionConfig(keyring(2), 2);
  const broker = brokerStub({
    executionKekCanaries: async () => [
      { keyVersion: 2, usedByCredential: false, encrypted },
      { keyVersion: 7, usedByCredential: true }
    ]
  });
  const service = new IntegrationCredentialKeyCoverageService(
    broker,
    new IntegrationCredentialCryptoService(config),
    config
  );

  await assert.rejects(
    service.onModuleInit(),
    /do not cover database encryption versions: 7/u
  );
});

function brokerStub(
  overrides: Partial<IntegrationCredentialExecutionBrokerService>
): IntegrationCredentialExecutionBrokerService {
  return {
    keyVersions: async () => ({ encryption: [], fingerprint: [] }),
    registerKekCanary: async (
      encrypted: EncryptedIntegrationCredential
    ): Promise<IntegrationCredentialKekCanaryRecord> => ({
      keyVersion: encrypted.keyVersion,
      encrypted
    }),
    executionKekCanaries: async () => [],
    ...overrides
  } as IntegrationCredentialExecutionBrokerService;
}

function keyring(version: number): string {
  return `${version}:${Buffer.alloc(32, version).toString("base64url")}`;
}

function managementConfig(
  keys: string,
  activeKeyVersion: number
): AppConfig {
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIAL_ROLE: "MANAGEMENT",
    INTEGRATION_CREDENTIAL_KEYS: keys,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: String(activeKeyVersion),
    INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `4:${fingerprintKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "4",
    PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
  });
}

function executionConfig(
  keys: string,
  activeKeyVersion: number
): AppConfig {
  return loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
    INTEGRATION_CREDENTIAL_KEYS: keys,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: String(activeKeyVersion)
  });
}
