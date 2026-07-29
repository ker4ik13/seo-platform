import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "./app-config.js";

const credentialApiToken = "c".repeat(32);

test("keeps optional adapters disabled by default", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test"
  });

  assert.equal(config.s3.enabled, false);
  assert.equal(config.email.enabled, false);
  assert.equal(config.malwareScanner.enabled, false);
  assert.equal(config.integrationCredentials.enabled, false);
  assert.equal(config.integrationCredentials.role, "DISABLED");
  assert.equal(config.integrationCredentials.keys.size, 0);
  assert.equal(config.integrationCredentials.fingerprintKeys.size, 0);
});

test("requires S3 buckets when S3 is enabled", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        S3_ENABLED: "true"
      }),
    { message: "S3 is enabled but credentials or buckets are incomplete" }
  );
});

test("loads bounded multipart upload defaults", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test"
  });

  assert.equal(config.uploads.partSizeBytes, 8 * 1_024 * 1_024);
  assert.equal(config.uploads.maxSizeBytes, 5 * 1_024 * 1_024 * 1_024);
  assert.equal(config.uploads.inspectionLeaseMinutes, 30);
  assert.equal(config.uploads.inspectionDispatchSeconds, 30);
  assert.equal(config.uploads.inspectionHeartbeatSeconds, 60);
  assert.equal(config.uploads.inspectionConcurrency, 2);
  assert.equal(config.imports.parseLeaseMinutes, 30);
  assert.equal(config.imports.parseConcurrency, 2);
  assert.equal(config.imports.stagingBatchRows, 1_000);
  assert.equal(config.imports.previewRows, 20);
  assert.equal(config.imports.publishBatchRows, 200);
  assert.equal(config.services.seoData, "http://localhost:4001");
});

test("requires a host when malware scanning is enabled", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        MALWARE_SCANNER_ENABLED: "true"
      }),
    /MALWARE_SCANNER_HOST/u
  );
});

test("loads a versioned integration credential keyring", () => {
  const first = Buffer.alloc(32, 1).toString("base64url");
  const second = Buffer.alloc(32, 2).toString("base64url");
  const fingerprint = Buffer.alloc(32, 3).toString("base64url");
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIALS_ENABLED: "true",
    INTEGRATION_CREDENTIAL_KEYS: `1:${first},2:${second}`,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "2",
    INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `7:${fingerprint}`,
    INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "7",
    PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
  });

  assert.equal(config.integrationCredentials.activeKeyVersion, 2);
  assert.equal(config.integrationCredentials.enabled, true);
  assert.equal(config.integrationCredentials.role, "MANAGEMENT");
  assert.deepEqual(
    config.integrationCredentials.keys.get(1),
    Buffer.alloc(32, 1)
  );
  assert.deepEqual(
    config.integrationCredentials.fingerprintKeys.get(7),
    Buffer.alloc(32, 3)
  );
});

test("requires credential encryption keys when the vault is enabled", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        INTERNAL_API_TOKEN: "i".repeat(32),
        INTEGRATION_CREDENTIALS_ENABLED: "true"
      }),
    /INTEGRATION_CREDENTIAL_KEYS/u
  );
});

test("allows a production worker without credential decryption capability", () => {
  const config = loadAppConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test",
    INTERNAL_API_TOKEN: "i".repeat(32)
  });

  assert.equal(config.integrationCredentials.enabled, false);
  assert.equal(config.integrationCredentials.role, "DISABLED");
  assert.equal(config.integrationCredentials.keys.size, 0);
  assert.equal(config.integrationCredentials.fingerprintKeys.size, 0);
});

test("rejects credential secrets on a credential-disabled process", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const fingerprintKey = Buffer.alloc(32, 2).toString("base64url");
  const credentialSecrets: readonly Readonly<Record<string, string>>[] = [
    {
      INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
    },
    {
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
    },
    {
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `2:${fingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "2"
    },
    {
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "2"
    },
    {
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
    }
  ];

  for (const extra of credentialSecrets) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          INTEGRATION_CREDENTIAL_ROLE: "DISABLED",
          ...extra
        }),
      /must not receive credential keyrings/u
    );
  }
});

test("loads a least-privilege execution credential role", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
    INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
  });

  assert.equal(config.integrationCredentials.enabled, true);
  assert.equal(config.integrationCredentials.role, "EXECUTION");
  assert.equal(config.integrationCredentials.fingerprintKeys.size, 0);
  assert.equal(config.integrationCredentialApiToken, undefined);
});

test("allows a production execution worker without internal API or NATS credentials", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const config = loadAppConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
    INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
  });

  assert.equal(config.integrationCredentials.role, "EXECUTION");
  assert.equal(config.internalApiToken, undefined);
  assert.equal(config.nats.user, undefined);
  assert.equal(config.nats.password, undefined);
});

test("rejects unrelated secrets on an execution-only worker", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const fingerprintKey = Buffer.alloc(32, 2).toString("base64url");
  const unrelatedSecrets: readonly Readonly<Record<string, string>>[] = [
    {
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `2:${fingerprintKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "2"
    },
    {
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32)
    },
    {
      INTERNAL_API_TOKEN: "i".repeat(32)
    },
    {
      NATS_USER: "connector-worker"
    },
    {
      NATS_PASSWORD: "n".repeat(32)
    },
    {
      S3_ENABLED: "true",
      S3_ACCESS_KEY_ID: "connector-s3-access",
      S3_SECRET_ACCESS_KEY: "connector-s3-secret",
      S3_BUCKET_UPLOADS: "uploads",
      S3_BUCKET_ARTIFACTS: "artifacts"
    },
    {
      EMAIL_ENABLED: "true",
      EMAIL_FROM: "no-reply@example.test",
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "connector-smtp-user",
      SMTP_PASSWORD: "connector-smtp-password"
    }
  ];

  for (const extra of unrelatedSecrets) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
          INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
          INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
          ...extra
        }),
      /must not receive management, internal API, NATS, S3 or SMTP credentials/u
    );
  }
});

test("still requires the internal API token for a production management process", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const fingerprintKey = Buffer.alloc(32, 2).toString("base64url");

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        INTEGRATION_CREDENTIAL_ROLE: "MANAGEMENT",
        INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
        INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
        INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `2:${fingerprintKey}`,
        INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "2",
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32)
      }),
    /INTERNAL_API_TOKEN/u
  );
});

test("rejects a conflicting execution legacy flag", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
        INTEGRATION_CREDENTIALS_ENABLED: "false",
        INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
        INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
      }),
    /conflicts with INTEGRATION_CREDENTIALS_ENABLED/u
  );
});

test("keeps the validation lease longer than the provider timeout", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTEGRATION_VALIDATION_TIMEOUT_MS: "10000",
        INTEGRATION_VALIDATION_LEASE_SECONDS: "14"
      }),
    /must exceed the provider timeout by at least 5 seconds/u
  );
});

test("bounds credential validation runtime settings", () => {
  const invalidSettings = [
    {
      INTEGRATION_VALIDATION_TIMEOUT_MS: "120001"
    },
    {
      INTEGRATION_VALIDATION_LEASE_SECONDS: "601"
    },
    {
      INTEGRATION_VALIDATION_DISPATCH_SECONDS: "4"
    },
    {
      INTEGRATION_VALIDATION_CONCURRENCY: "33"
    }
  ] as const;

  for (const invalid of invalidSettings) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          ...invalid
        }),
      /must be between/u
    );
  }
});

test("requires an independent fingerprint keyring for idempotency", () => {
  const key = Buffer.alloc(32, 1).toString("base64url");
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTEGRATION_CREDENTIALS_ENABLED: "true",
        INTEGRATION_CREDENTIAL_KEYS: `1:${key}`,
        INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
      }),
    /INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS/u
  );
});

test("requires a dedicated Platform API caller token for the vault", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const fingerprintKey = Buffer.alloc(32, 2).toString("base64url");
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTEGRATION_CREDENTIALS_ENABLED: "true",
        INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
        INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
        INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `4:${fingerprintKey}`,
        INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "4"
      }),
    /PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN/u
  );
});

test("keeps the credential caller token separate from shared service auth", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const fingerprintKey = Buffer.alloc(32, 2).toString("base64url");
  const reusedToken = "x".repeat(32);
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTEGRATION_CREDENTIAL_ROLE: "MANAGEMENT",
        INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
        INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
        INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `2:${fingerprintKey}`,
        INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "2",
        INTERNAL_API_TOKEN: reusedToken,
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: reusedToken
      }),
    /must differ from the shared internal API token/u
  );
});

test("rejects reused encryption and fingerprint key material", () => {
  const key = Buffer.alloc(32, 1).toString("base64url");
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTEGRATION_CREDENTIALS_ENABLED: "true",
        INTEGRATION_CREDENTIAL_KEYS: `1:${key}`,
        INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
        INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `4:${key}`,
        INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "4",
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: credentialApiToken
      }),
    /must use different key material/u
  );
});

test("rejects reused key material under two versions of one keyring", () => {
  const key = Buffer.alloc(32, 1).toString("base64url");
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTEGRATION_CREDENTIAL_KEYS: `1:${key},2:${key}`,
        INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "2"
      }),
    /unique 32-byte keys/u
  );
});

test("rejects an encryption key version outside PostgreSQL integer range", () => {
  const key = Buffer.alloc(32, 1).toString("base64url");
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTEGRATION_CREDENTIALS_ENABLED: "true",
        INTEGRATION_CREDENTIAL_KEYS: `2147483648:${key}`,
        INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "2147483648"
      }),
    /INTEGRATION_CREDENTIAL_KEYS/u
  );
});
