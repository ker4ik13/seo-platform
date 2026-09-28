import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAppConfig,
  loadSystemWorkerConfig,
  type JobsProcessRole
} from "./app-config.js";

const credentialApiToken = "c".repeat(32);
const rankManifestApiToken = "m".repeat(32);
const rankResultApiToken = "r".repeat(32);
const rankGrantApiToken = "g".repeat(32);
const rankBillingSettlementApiToken = "b".repeat(32);
const automationDispatchApiToken = "a".repeat(32);

test("keeps optional adapters disabled by default", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test"
  });

  assert.equal(config.s3.enabled, false);
  assert.equal(config.bindAddress, "127.0.0.1");
  assert.equal(config.email.enabled, false);
  assert.equal(config.malwareScanner.enabled, false);
  assert.equal(config.integrationCredentials.enabled, false);
  assert.equal(config.integrationCredentials.role, "DISABLED");
  assert.equal(config.integrationCredentials.keys.size, 0);
  assert.equal(config.integrationCredentials.fingerprintKeys.size, 0);
  assert.equal(config.connectorRuntime.dispatchIntervalMs, 1_000);
  assert.equal(config.connectorRuntime.paidExecutionEnabled, true);
  assert.equal(config.connectorRuntime.shardIndex, 0);
  assert.equal(config.connectorRuntime.shardCount, 1);
  assert.equal(config.connectorRuntime.rankConcurrency, 4);
  assert.equal(config.connectorRuntime.xmlStockGlobalHttpConcurrency, 96);
  assert.equal(config.rankPreparation.enabled, false);
  assert.equal(config.rankManifestApiToken, undefined);
  assert.equal(config.rankGrantApiToken, undefined);
  assert.equal(config.rankExecution.submitEnabled, false);
  assert.deepEqual(config.platformProviderCredentials, {});
  assert.equal(config.xmlStockSoftId, undefined);
  assert.equal(
    config.rankExecution.killSwitchVersion,
    "arsenkin-positions@4"
  );
});

test("loads the XMLStock partner ID independently of platform credentials", () => {
  const softId = "a".repeat(32);
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    PLATFORM_XMLSTOCK_SOFT_ID: ` ${softId} `
  });
  assert.equal(config.xmlStockSoftId, softId);
  assert.deepEqual(config.platformProviderCredentials, {});
  assert.throws(
    () => loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_XMLSTOCK_SOFT_ID: "invalid"
    }),
    /PLATFORM_XMLSTOCK_SOFT_ID must be a 32-character hexadecimal identifier/u
  );
});

test("exposes only explicitly enabled and complete platform provider credentials", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    PLATFORM_XMLSTOCK_ENABLED: "true",
    PLATFORM_XMLSTOCK_API_KEYS: "xmlstock-secret-1, xmlstock-secret-2",
    PLATFORM_XMLSTOCK_ACCOUNT_IDS: "account-41,account-42",
    PLATFORM_ARSENKIN_ENABLED: "false",
    PLATFORM_ARSENKIN_API_KEY: "ignored staged value with whitespace"
  });

  assert.deepEqual(config.platformProviderCredentials, {
    XMLSTOCK: [
      {
        apiKey: "xmlstock-secret-1",
        accountIdentifier: "account-41"
      },
      {
        apiKey: "xmlstock-secret-2",
        accountIdentifier: "account-42"
      }
    ]
  });
});

test("loads comma-separated Arsenkin keys and paired XMLStock accounts", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    PLATFORM_XMLSTOCK_ENABLED: "true",
    PLATFORM_XMLSTOCK_API_KEYS: "xmlstock-key-1,xmlstock-key-2",
    PLATFORM_XMLSTOCK_ACCOUNT_IDS: "account-1,account-2",
    PLATFORM_ARSENKIN_ENABLED: "true",
    PLATFORM_ARSENKIN_API_KEYS: "arsenkin-key-1, arsenkin-key-2"
  });

  assert.deepEqual(config.platformProviderCredentials, {
    XMLSTOCK: [
      { apiKey: "xmlstock-key-1", accountIdentifier: "account-1" },
      { apiKey: "xmlstock-key-2", accountIdentifier: "account-2" }
    ],
    ARSENKIN: [
      { apiKey: "arsenkin-key-1" },
      { apiKey: "arsenkin-key-2" }
    ]
  });
});

test("rejects ambiguous or malformed platform credential pools", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    PLATFORM_ARSENKIN_ENABLED: "true"
  } as const;
  assert.throws(
    () => loadAppConfig({
      ...base,
      PLATFORM_ARSENKIN_API_KEY: "legacy-key",
      PLATFORM_ARSENKIN_API_KEYS: "pooled-key"
    }),
    /conflicts with legacy/u
  );
  assert.throws(
    () => loadAppConfig({
      ...base,
      PLATFORM_ARSENKIN_API_KEYS: "same-key,same-key"
    }),
    /must not contain duplicate keys/u
  );
  assert.throws(
    () => loadAppConfig({
      ...base,
      PLATFORM_ARSENKIN_API_KEY: "legacy-key,second-key"
    }),
    /without whitespace or commas/u
  );
  assert.throws(
    () => loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_XMLSTOCK_ENABLED: "true",
      PLATFORM_XMLSTOCK_API_KEYS: "xmlstock-key-1,xmlstock-key-2",
      PLATFORM_XMLSTOCK_ACCOUNT_IDS: "account-1"
    }),
    /exactly one identifier per API key in the same order/u
  );
  assert.throws(
    () => loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_XMLSTOCK_ENABLED: "true",
      PLATFORM_XMLSTOCK_API_KEYS: "xmlstock-key-1,xmlstock-key-2",
      PLATFORM_XMLSTOCK_ACCOUNT_IDS: "account-1,account-1"
    }),
    /must not contain duplicate identifiers/u
  );
});

test("fails closed when an enabled platform provider has no complete credential", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_XMLSTOCK_ENABLED: "true",
        PLATFORM_XMLSTOCK_API_KEY: "xmlstock-secret"
      }),
    /PLATFORM_XMLSTOCK_API_KEYS and PLATFORM_XMLSTOCK_ACCOUNT_IDS/u
  );
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_ARSENKIN_ENABLED: "true"
      }),
    /PLATFORM_ARSENKIN_API_KEYS is required/u
  );
});

test("uses only explicit loopback or container bind addresses", () => {
  assert.equal(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      BIND_ADDRESS: "0.0.0.0"
    }).bindAddress,
    "0.0.0.0"
  );
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        BIND_ADDRESS: "loopback.invalid"
      }),
    /BIND_ADDRESS must be 127\.0\.0\.1 or 0\.0\.0\.0/u
  );
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
  assert.equal(config.imports.stagingBatchRows, 5_000);
  assert.equal(config.imports.previewRows, 20);
  assert.equal(config.imports.publishBatchRows, 5_000);
  assert.equal(config.services.seoData, "http://127.0.0.1:4001");
  assert.equal(config.services.platformApi, "http://127.0.0.1:4000");
  assert.equal(config.platformApiCommandTimeoutMs, 5_000);
  assert.equal(config.rankPreparation.leaseSeconds, 120);
  assert.equal(config.rankPreparation.dispatchSeconds, 15);
  assert.equal(
    config.rankPreparation.resultPersistenceDispatchIntervalMs,
    1_000
  );
  assert.equal(config.rankPreparation.concurrency, 2);
});

test("loads an isolated rank preparation worker", () => {
  const config = loadAppConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test",
    RANK_PREPARATION_ENABLED: "true",
    JOBS_TO_SEO_RANK_TOKEN: rankManifestApiToken,
    JOBS_TO_SEO_RANK_RESULT_TOKEN: rankResultApiToken,
    JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: rankGrantApiToken,
    PLATFORM_API_URL: "http://backend-core:4000",
    PLATFORM_API_COMMAND_TIMEOUT_MS: "2500",
    RANK_RESULT_PERSISTENCE_DISPATCH_INTERVAL_MS: "750"
  });

  assert.equal(config.rankPreparation.enabled, true);
  assert.equal(config.rankManifestApiToken, rankManifestApiToken);
  assert.equal(config.rankResultApiToken, rankResultApiToken);
  assert.equal(config.rankGrantApiToken, rankGrantApiToken);
  assert.equal(config.services.platformApi, "http://backend-core:4000");
  assert.equal(config.platformApiCommandTimeoutMs, 2_500);
  assert.equal(
    config.rankPreparation.resultPersistenceDispatchIntervalMs,
    750
  );
  assert.equal(config.integrationCredentials.role, "DISABLED");
  assert.equal(config.platformApiToken, undefined);
  assert.equal(config.seoDataApiToken, undefined);
});

test("rejects rank tokens outside the isolated rank worker", () => {
  for (const token of [
    { JOBS_TO_SEO_RANK_TOKEN: rankManifestApiToken },
    { JOBS_TO_SEO_RANK_RESULT_TOKEN: rankResultApiToken },
    { JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: rankGrantApiToken }
  ]) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          ...token
        }),
      /Only the enabled rank preparation worker/u
    );
  }
});

test("keeps the billing settlement token on the connector worker only", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN:
          rankBillingSettlementApiToken
      }),
    /Only the connector worker/u
  );
});

test("requires both dedicated tokens on the rank worker", () => {
  for (const token of [
    { JOBS_TO_SEO_RANK_TOKEN: rankManifestApiToken },
    { JOBS_TO_SEO_RANK_RESULT_TOKEN: rankResultApiToken },
    { JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: rankGrantApiToken }
  ]) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          RANK_PREPARATION_ENABLED: "true",
          ...token
        }),
      /with at least 32 characters is required/u
    );
  }
});

test("rejects unrelated secrets and short leases on rank workers", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    RANK_PREPARATION_ENABLED: "true",
    JOBS_TO_SEO_RANK_TOKEN: rankManifestApiToken,
    JOBS_TO_SEO_RANK_RESULT_TOKEN: rankResultApiToken,
    JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: rankGrantApiToken
  };
  assert.throws(
    () =>
      loadAppConfig({
        ...base,
        PLATFORM_API_TO_JOBS_TOKEN: "i".repeat(32)
      }),
    /Only the Jobs HTTP process may receive/u
  );
  assert.throws(
    () =>
      loadAppConfig({
        ...base,
        SEO_DATA_COMMAND_TIMEOUT_MS: "60000",
        RANK_PREPARATION_LEASE_SECONDS: "60"
      }),
    /must exceed the SEO Data timeout/u
  );
});

test("keeps every rank service token distinct", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        RANK_PREPARATION_ENABLED: "true",
        JOBS_TO_SEO_RANK_TOKEN: rankManifestApiToken,
        JOBS_TO_SEO_RANK_RESULT_TOKEN: rankResultApiToken,
        JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: rankManifestApiToken
      }),
    /Rank manifest token must differ/u
  );
});

test("bounds the Platform API command timeout", () => {
  for (const timeout of ["499", "10001"]) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          PLATFORM_API_COMMAND_TIMEOUT_MS: timeout
        }),
      /PLATFORM_API_COMMAND_TIMEOUT_MS must be between/u
    );
  }
});

test("allows recorded provider submit only on the execution connector worker", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const development = loadAppConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test",
    JOBS_TO_SEO_DATA_TOKEN: "s".repeat(32),
    INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
    INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN:
      rankBillingSettlementApiToken,
    RANK_PROVIDER_SUBMIT_ENABLED: "true",
    RANK_PROVIDER_KILL_SWITCH_VERSION: "arsenkin-positions@4"
  });
  assert.equal(development.rankExecution.submitEnabled, true);
  assert.equal(
    development.rankBillingSettlementApiToken,
    rankBillingSettlementApiToken
  );
  assert.equal(
    development.rankExecution.killSwitchVersion,
    "arsenkin-positions@4"
  );

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        JOBS_TO_SEO_DATA_TOKEN: "s".repeat(32),
        INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
        INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
        INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
        RANK_PROVIDER_SUBMIT_ENABLED: "true"
      }),
    /JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN/u
  );
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        RANK_PREPARATION_ENABLED: "true",
        JOBS_TO_SEO_RANK_TOKEN: rankManifestApiToken,
        JOBS_TO_SEO_RANK_RESULT_TOKEN: rankResultApiToken,
        JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: rankGrantApiToken,
        RANK_PROVIDER_SUBMIT_ENABLED: "true"
      }),
    /only for the connector worker/u
  );
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        RANK_PROVIDER_KILL_SWITCH_VERSION: "Arsenkin Positions"
      }),
    /RANK_PROVIDER_KILL_SWITCH_VERSION/u
  );
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
        PLATFORM_API_TO_JOBS_TOKEN: "p".repeat(32),
        JOBS_TO_PLATFORM_AUTOMATION_TOKEN: automationDispatchApiToken,
        JOBS_TO_SEO_DATA_TOKEN: "s".repeat(32),
        NATS_USER: "jobs-http",
        NATS_PASSWORD: "secret",
        INTEGRATION_CREDENTIALS_ENABLED: "true"
      }),
    /INTEGRATION_CREDENTIAL_KEYS/u
  );
});

test("loads the system worker from a Redis-only config boundary", () => {
  const config = loadSystemWorkerConfig({
    NODE_ENV: "production",
    REDIS_URL: "redis://:secret@redis:6379",
    SYSTEM_WORKER_CONCURRENCY: "7"
  });

  assert.equal(config.nodeEnv, "production");
  assert.equal(config.redisUrl, "redis://:secret@redis:6379");
  assert.equal(config.concurrency, 7);
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

test("rejects staged platform source pools on every non-management process", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
        INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
        INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
        PLATFORM_ARSENKIN_ENABLED: "false",
        PLATFORM_ARSENKIN_API_KEYS: "must-never-reach-connector"
      }),
    /must not receive platform provider source credentials/u
  );
});

test("allows a production execution worker with only SEO publication auth", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const config = loadAppConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test",
    JOBS_TO_SEO_DATA_TOKEN: "s".repeat(32),
    INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
    INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
  });

  assert.equal(config.integrationCredentials.role, "EXECUTION");
  assert.equal(config.platformApiToken, undefined);
  assert.equal(config.seoDataApiToken, "s".repeat(32));
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
      PLATFORM_API_TO_JOBS_TOKEN: "i".repeat(32)
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
      EMAIL_MESSAGE_ID_DOMAIN: "mail.example.test",
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
      /Only the (?:Jobs HTTP|auth-email worker) process may receive|must not receive management, Platform API, NATS, S3 or SMTP credentials|must not receive (?:NATS|S3|SMTP)|must be configured together/u
    );
  }
});

test("requires both caller/audience tokens for the production HTTP process", () => {
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
    /PLATFORM_API_TO_JOBS_TOKEN/u
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

test("bounds the fast connector runtime dispatch interval", () => {
  assert.equal(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS: "750"
    }).connectorRuntime.dispatchIntervalMs,
    750
  );
  for (const value of ["249", "60001"]) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS: value
        }),
      /CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS must be between/u
    );
  }
});

test("requires database capacity for all connector worker queues", () => {
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const connectorEnvironment = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
    INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
  } as const;

  assert.throws(
    () =>
      loadAppConfig(
        {
          ...connectorEnvironment,
          DATABASE_POOL_MAX: "5",
          INTEGRATION_VALIDATION_CONCURRENCY: "2",
          RANK_CONNECTOR_CONCURRENCY: "16",
          FREQUENCY_COLLECTION_CONCURRENCY: "8",
          KEYWORD_RESEARCH_CONCURRENCY: "2"
        },
        "CONNECTOR_WORKER"
      ),
    /DATABASE_POOL_MAX must be at least 8/u
  );

  const config = loadAppConfig(
    {
      ...connectorEnvironment,
      DATABASE_POOL_MAX: "12",
      INTEGRATION_VALIDATION_CONCURRENCY: "1",
      RANK_CONNECTOR_CONCURRENCY: "4",
      FREQUENCY_COLLECTION_CONCURRENCY: "1",
      KEYWORD_RESEARCH_CONCURRENCY: "1"
    },
    "CONNECTOR_WORKER"
  );
  assert.equal(config.databasePoolMax, 12);
  assert.equal(config.connectorRuntime.rankConcurrency, 4);
  assert.equal(config.connectorRuntime.frequencyConcurrency, 1);
  assert.equal(config.connectorRuntime.keywordResearchConcurrency, 1);
  assert.equal(config.integrationCredentialValidation.concurrency, 1);
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

test("keeps the credential caller token separate from HTTP audience auth", () => {
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
        PLATFORM_API_TO_JOBS_TOKEN: reusedToken,
        JOBS_TO_SEO_DATA_TOKEN: "s".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: reusedToken
      }),
    /must differ/u
  );
});

test("allows SEO Data auth only on HTTP and SEO-calling worker roles", () => {
  const token = "s".repeat(32);
  const importConfig = loadAppConfig(
    {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_SEO_DATA_TOKEN: token
    },
    "IMPORT_WORKER"
  );
  assert.equal(importConfig.seoDataApiToken, token);
  assert.equal(importConfig.platformApiToken, undefined);
  const crawlConfig = loadAppConfig(
    {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_SEO_DATA_TOKEN: token,
      CRAWL_CONTACT_URL: "https://app.example.test/crawler"
    },
    "CRAWL_WORKER"
  );
  assert.equal(crawlConfig.seoDataApiToken, token);
  assert.equal(crawlConfig.crawl.enabled, true);
  const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
  const connectorConfig = loadAppConfig(
    {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_SEO_DATA_TOKEN: token,
      INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
      INTEGRATION_CREDENTIAL_KEYS: `1:${encryptionKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
    },
    "CONNECTOR_WORKER"
  );
  assert.equal(connectorConfig.seoDataApiToken, token);

  for (const role of ["INSPECTION_WORKER"] as const) {
    assert.throws(
      () =>
        loadAppConfig(
          {
            NODE_ENV: "test",
            DATABASE_URL: "postgresql://test",
            JOBS_TO_SEO_DATA_TOKEN: token
          },
          role
        ),
      /Only the Jobs HTTP, import-worker, crawl-worker and connector-worker processes/u
    );
  }
  assert.throws(
    () =>
      loadSystemWorkerConfig({
        NODE_ENV: "test",
        REDIS_URL: "redis://test",
        JOBS_TO_SEO_DATA_TOKEN: token
      }),
    /SYSTEM_WORKER must not receive JOBS_TO_SEO_DATA_TOKEN/u
  );
});

test("rejects process-role and capability-role mismatches", () => {
  assert.throws(
    () =>
      loadAppConfig(
        {
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test"
        },
        "RANK_WORKER"
      ),
    /requires RANK_PREPARATION_ENABLED=true/u
  );
  assert.throws(
    () =>
      loadAppConfig(
        {
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          RANK_PREPARATION_ENABLED: "true",
          JOBS_TO_SEO_RANK_TOKEN: rankManifestApiToken,
          JOBS_TO_SEO_RANK_RESULT_TOKEN: rankResultApiToken,
          JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: rankGrantApiToken
        },
        "HTTP"
      ),
    /Only the rank-worker process/u
  );
  assert.throws(
    () =>
      loadAppConfig(
        {
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test"
        },
        "CONNECTOR_WORKER"
      ),
    /requires the EXECUTION credential role/u
  );
});

test("rejects the retired shared internal token", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTERNAL_API_TOKEN: "i".repeat(32)
      }),
    /INTERNAL_API_TOKEN is no longer supported/u
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

test("rejects every package env example service-token placeholder", () => {
  const placeholders = [
    [
      "PLATFORM_API_TO_JOBS_TOKEN",
      "replace-with-a-distinct-random-platform-api-token"
    ],
    [
      "JOBS_TO_SEO_DATA_TOKEN",
      "replace-with-a-distinct-random-seo-data-token"
    ],
    [
      "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
      "replace-with-a-distinct-random-credential-token"
    ]
  ] as const;

  for (const [key, value] of placeholders) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          [key]: value
        }),
      new RegExp(`${key} must be a non-placeholder ASCII service token`, "u")
    );
  }
});

test("validates the finite service-token format for every Jobs boundary", () => {
  const keys = [
    "PLATFORM_API_TO_JOBS_TOKEN",
    "JOBS_TO_SEO_DATA_TOKEN",
    "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
    "JOBS_TO_SEO_RANK_TOKEN",
    "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN",
    "JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN"
  ] as const;
  const invalidTokens = [
    "x".repeat(31),
    "x".repeat(513),
    `${"x".repeat(32)} `,
    `${"x".repeat(32)},`,
    `${"x".repeat(32)}\u0000`,
    `${"x".repeat(31)}я`,
    "example-service-token-that-is-not-secret"
  ] as const;

  for (const key of keys) {
    for (const value of invalidTokens) {
      assert.throws(
        () =>
          loadAppConfig({
            NODE_ENV: "test",
            DATABASE_URL: "postgresql://test",
            [key]: value
          }),
        new RegExp(`${key} must be a non-placeholder ASCII service token`, "u")
      );
    }
  }
});

test("rejects all application, database and adapter capabilities on the Redis-only system worker", () => {
  const forbidden = [
    ["DATABASE_URL", "postgresql://secret@postgres/jobs_db"],
    ["DATABASE_POOL_MAX", "20"],
    ["PGPASSWORD", "secret"],
    ["POSTGRES_PASSWORD", "secret"],
    ["JOBS_DATABASE_PASSWORD", "secret"],
    ["JOBS_CONNECTOR_DATABASE_PASSWORD", "secret"],
    ["NATS_URL", "nats://nats:4222"],
    ["NATS_USER", "system"],
    ["NATS_PASSWORD", "secret"],
    ["S3_ENABLED", "false"],
    ["S3_ACCESS_KEY_ID", "access"],
    ["S3_SECRET_ACCESS_KEY", "secret"],
    ["EMAIL_ENABLED", "false"],
    ["SMTP_USER", "system"],
    ["SMTP_PASSWORD", "secret"],
    ["MALWARE_SCANNER_ENABLED", "false"],
    ["MALWARE_SCANNER_HOST", "clamav"],
    ["INTEGRATION_CREDENTIAL_ROLE", "DISABLED"],
    ["INTEGRATION_CREDENTIAL_KEYS", "secret"],
    ["RANK_PREPARATION_ENABLED", "false"],
    ["SEO_DATA_URL", "http://seo-data:4001"],
    ["PLATFORM_API_URL", "http://backend-core:4000"],
    ["PLATFORM_API_TO_JOBS_TOKEN", "p".repeat(32)],
    ["JOBS_TO_SEO_DATA_TOKEN", "s".repeat(32)],
    ["PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN", "c".repeat(32)],
    ["JOBS_TO_SEO_RANK_TOKEN", "m".repeat(32)],
    ["JOBS_TO_PLATFORM_RANK_GRANT_TOKEN", "g".repeat(32)],
    ["JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN", "b".repeat(32)],
    ["JOBS_TO_SEO_RANK_RESULT_TOKEN", "r".repeat(32)]
  ] as const;

  for (const [key, value] of forbidden) {
    assert.throws(
      () =>
        loadSystemWorkerConfig({
          NODE_ENV: "test",
          REDIS_URL: "redis://test",
          [key]: value
        }),
      new RegExp(`SYSTEM_WORKER must not receive ${key}`, "u")
    );
  }
  assert.throws(
    () =>
      loadAppConfig(
        { NODE_ENV: "test", DATABASE_URL: "postgresql://test" },
        "SYSTEM_WORKER"
      ),
    /must use loadSystemWorkerConfig/u
  );
  assert.throws(
    () => loadSystemWorkerConfig({ NODE_ENV: "production" }),
    /REDIS_URL is required/u
  );
});

test("rejects incomplete and URL-embedded NATS credentials", () => {
  for (const extra of [
    { NATS_USER: "jobs" },
    { NATS_PASSWORD: "secret" },
    { NATS_URL: "nats://jobs:secret@nats:4222" }
  ]) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          ...extra
        }),
      /must be configured together|must not contain credentials/u
    );
  }
});

test("loads only the declared adapter capabilities for HTTP, import and inspection", () => {
  const s3 = {
    S3_ENABLED: "true",
    S3_ACCESS_KEY_ID: "access",
    S3_SECRET_ACCESS_KEY: "secret",
    S3_BUCKET_UPLOADS: "uploads",
    S3_BUCKET_ARTIFACTS: "artifacts",
    S3_KEY_PREFIX: "seo-platform/production"
  } as const;
  const http = loadAppConfig(
    {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      NATS_URL: "nats://nats:4222",
      NATS_USER: "jobs-http",
      NATS_PASSWORD: "secret",
      PLATFORM_API_TO_JOBS_TOKEN: "p".repeat(32),
      JOBS_TO_SEO_DATA_TOKEN: "s".repeat(32),
      INTEGRATION_CREDENTIAL_ROLE: "MANAGEMENT",
      INTEGRATION_CREDENTIAL_KEYS: `1:${Buffer.alloc(32, 1).toString("base64url")}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: `2:${Buffer.alloc(32, 2).toString("base64url")}`,
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION: "2",
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
      ...s3
    },
    "HTTP"
  );
  assert.equal(http.nats.user, "jobs-http");
  assert.equal(http.s3.enabled, true);
  assert.equal(http.s3.objectKeyPrefix, "seo-platform/production");
  assert.equal(http.email.enabled, false);
  assert.equal(http.integrationCredentials.role, "MANAGEMENT");

  const authEmailWorker = loadAppConfig(
    {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      NATS_URL: "nats://nats:4222",
      NATS_USER: "jobs-auth-email",
      NATS_PASSWORD: "nats-secret",
      AUTH_EMAIL_EVENT_ENVIRONMENT: "test",
      JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN: "e".repeat(32),
      EMAIL_ENABLED: "true",
      EMAIL_FROM: "jobs@example.test",
      EMAIL_MESSAGE_ID_DOMAIN: "mail.example.test",
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "jobs",
      SMTP_PASSWORD: "smtp-secret"
    },
    "AUTH_EMAIL_WORKER"
  );
  assert.equal(authEmailWorker.authEmail.enabled, true);
  assert.equal(authEmailWorker.authEmail.environment, "test");
  assert.equal(authEmailWorker.email.enabled, true);
  assert.equal(authEmailWorker.authEmailApiToken, "e".repeat(32));

  const importWorker = loadAppConfig(
    {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_SEO_DATA_TOKEN: "s".repeat(32),
      ...s3
    },
    "IMPORT_WORKER"
  );
  assert.equal(importWorker.s3.enabled, true);
  assert.equal(importWorker.seoDataApiToken, "s".repeat(32));

  const inspectionWorker = loadAppConfig(
    {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      MALWARE_SCANNER_ENABLED: "true",
      MALWARE_SCANNER_HOST: "clamav",
      ...s3
    },
    "INSPECTION_WORKER"
  );
  assert.equal(inspectionWorker.s3.enabled, true);
  assert.equal(inspectionWorker.malwareScanner.enabled, true);
});

test("rejects every undeclared adapter capability by process role", () => {
  const connectorKey = Buffer.alloc(32, 1).toString("base64url");
  const roleBases: Readonly<Record<Exclude<JobsProcessRole, "SYSTEM_WORKER">, NodeJS.ProcessEnv>> = {
    HTTP: { NODE_ENV: "test", DATABASE_URL: "postgresql://test" },
    IMPORT_WORKER: { NODE_ENV: "test", DATABASE_URL: "postgresql://test" },
    INSPECTION_WORKER: { NODE_ENV: "test", DATABASE_URL: "postgresql://test" },
    CRAWL_WORKER: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_SEO_DATA_TOKEN: "s".repeat(32)
    },
    RANK_WORKER: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      RANK_PREPARATION_ENABLED: "true",
      JOBS_TO_SEO_RANK_TOKEN: "m".repeat(32),
      JOBS_TO_SEO_RANK_RESULT_TOKEN: "r".repeat(32),
      JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: "g".repeat(32)
    },
    CONNECTOR_WORKER: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      JOBS_TO_SEO_DATA_TOKEN: "s".repeat(32),
      INTEGRATION_CREDENTIAL_ROLE: "EXECUTION",
      INTEGRATION_CREDENTIAL_KEYS: `1:${connectorKey}`,
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "1"
    },
    AUTH_EMAIL_WORKER: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      NATS_USER: "jobs-auth-email",
      NATS_PASSWORD: "nats-secret",
      AUTH_EMAIL_EVENT_ENVIRONMENT: "test",
      JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN: "e".repeat(32),
      EMAIL_ENABLED: "true",
      EMAIL_FROM: "jobs@example.test",
      EMAIL_MESSAGE_ID_DOMAIN: "mail.example.test",
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "jobs",
      SMTP_PASSWORD: "smtp-secret"
    }
  };
  const cases = [
    {
      roles: ["IMPORT_WORKER", "INSPECTION_WORKER", "RANK_WORKER", "CONNECTOR_WORKER"],
      extra: { NATS_URL: "nats://nats:4222" },
      error: /must not receive NATS/u
    },
    {
      roles: ["RANK_WORKER", "CONNECTOR_WORKER", "AUTH_EMAIL_WORKER"],
      extra: {
        S3_ENABLED: "true",
        S3_ACCESS_KEY_ID: "access",
        S3_SECRET_ACCESS_KEY: "secret",
        S3_BUCKET_UPLOADS: "uploads",
        S3_BUCKET_ARTIFACTS: "artifacts"
      },
      error: /must not receive S3/u
    },
    {
      roles: ["HTTP", "IMPORT_WORKER", "INSPECTION_WORKER", "RANK_WORKER", "CONNECTOR_WORKER"],
      extra: {
        EMAIL_ENABLED: "true",
        EMAIL_FROM: "jobs@example.test",
        EMAIL_MESSAGE_ID_DOMAIN: "mail.example.test",
        SMTP_HOST: "smtp.example.test",
        SMTP_USER: "jobs",
        SMTP_PASSWORD: "secret"
      },
      error: /must not receive SMTP|Only the auth-email worker|Execution-only credential workers/u
    },
    {
      roles: ["HTTP", "IMPORT_WORKER", "RANK_WORKER", "CONNECTOR_WORKER", "AUTH_EMAIL_WORKER"],
      extra: {
        MALWARE_SCANNER_ENABLED: "true",
        MALWARE_SCANNER_HOST: "clamav"
      },
      error: /must not receive malware scanner/u
    }
  ] as const;

  for (const boundary of cases) {
    for (const role of boundary.roles) {
      assert.throws(
        () => loadAppConfig({ ...roleBases[role], ...boundary.extra }, role),
        boundary.error
      );
    }
  }
});

test("rejects adapter credentials left behind while the capability is disabled", () => {
  for (const [extra, error] of [
    [{ S3_ACCESS_KEY_ID: "access" }, /S3 credentials must be absent/u],
    [{ S3_SECRET_ACCESS_KEY: "secret" }, /S3 credentials must be absent/u],
    [{ SMTP_USER: "jobs" }, /SMTP credentials must be absent/u],
    [{ SMTP_PASSWORD: "secret" }, /SMTP credentials must be absent/u],
    [
      { MALWARE_SCANNER_HOST: "clamav" },
      /MALWARE_SCANNER_HOST must be absent/u
    ]
  ] as const) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          ...extra
        }),
      error
    );
  }
});

test("rejects unsafe S3 object prefixes", () => {
  for (const prefix of ["/absolute", "folder/", "folder//nested", "folder/../other"] as const) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          S3_ENABLED: "true",
          S3_ACCESS_KEY_ID: "access",
          S3_SECRET_ACCESS_KEY: "secret",
          S3_BUCKET_UPLOADS: "uploads",
          S3_BUCKET_ARTIFACTS: "artifacts",
          S3_KEY_PREFIX: prefix
        }),
      /S3_KEY_PREFIX/u
    );
  }
});

test("enforces the isolated auth-email worker environment and timeout budget", () => {
  const base = {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    NATS_URL: "nats://nats:4222",
    NATS_USER: "jobs-auth-email",
    NATS_PASSWORD: "nats-secret",
    AUTH_EMAIL_EVENT_ENVIRONMENT: "test",
    JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN: "e".repeat(32),
    EMAIL_ENABLED: "true",
    EMAIL_FROM: "jobs@example.test",
    EMAIL_MESSAGE_ID_DOMAIN: "mail.example.test",
    SMTP_HOST: "smtp.example.test",
    SMTP_USER: "jobs",
    SMTP_PASSWORD: "smtp-secret"
  };

  for (const environment of ["bad_env", "-bad", "bad-"]) {
    assert.throws(
      () =>
        loadAppConfig(
          { ...base, AUTH_EMAIL_EVENT_ENVIRONMENT: environment },
          "AUTH_EMAIL_WORKER"
        ),
      /AUTH_EMAIL_EVENT_ENVIRONMENT must be/u
    );
  }
  assert.throws(
    () =>
      loadAppConfig(
        {
          ...base,
          AUTH_EMAIL_LEASE_SECONDS: "30",
          PLATFORM_API_COMMAND_TIMEOUT_MS: "10000",
          SMTP_CONNECTION_TIMEOUT_MS: "30000",
          SMTP_SOCKET_TIMEOUT_MS: "120000"
        },
        "AUTH_EMAIL_WORKER"
      ),
    /AUTH_EMAIL_LEASE_SECONDS must cover/u
  );
  assert.throws(
    () =>
      loadAppConfig(
        {
          ...base,
          AUTH_EMAIL_LEASE_SECONDS: "100",
          AUTH_EMAIL_PUBLISH_TIMEOUT_MS: "10000"
        },
        "AUTH_EMAIL_WORKER"
      ),
    /DLQ publish timeouts/u
  );
  assert.throws(
    () =>
      loadAppConfig(
        { ...base, REDIS_URL: "redis://redis:6379" },
        "AUTH_EMAIL_WORKER"
    ),
    /must not receive Redis/u
  );

  for (const [extra, error] of [
    [
      { EMAIL_FROM: "jobs@example.test\r\nBcc: victim@example.test" },
      /EMAIL_FROM must be/u
    ],
    [{ EMAIL_FROM: "Display Name <jobs@example.test>" }, /EMAIL_FROM must be/u],
    [{ SMTP_HOST: "smtp://smtp.example.test" }, /SMTP_HOST must be/u],
    [{ SMTP_HOST: "user@smtp.example.test" }, /SMTP_HOST must be/u],
    [{ SMTP_USER: "jobs\nadmin" }, /SMTP_USER must contain/u],
    [{ SMTP_PASSWORD: "secret\r\nvalue" }, /SMTP_PASSWORD must contain/u],
    [{ SMTP_PORT: "65536" }, /SMTP_PORT must be between/u],
    [
      { EMAIL_MESSAGE_ID_DOMAIN: oversizedMessageIdDomain() },
      /EMAIL_MESSAGE_ID_DOMAIN must be/u
    ]
  ] as const) {
    assert.throws(
      () =>
        loadAppConfig({ ...base, ...extra }, "AUTH_EMAIL_WORKER"),
      error
    );
  }

  const rawCredentials = loadAppConfig(
    {
      ...base,
      SMTP_USER: "tenant/jobs+auth=mail@example.test",
      SMTP_PASSWORD: " leading and trailing password "
    },
    "AUTH_EMAIL_WORKER"
  );
  assert.equal(
    rawCredentials.email.user,
    "tenant/jobs+auth=mail@example.test"
  );
  assert.equal(
    rawCredentials.email.password,
    " leading and trailing password "
  );
});

function oversizedMessageIdDomain(): string {
  return [
    "a".repeat(63),
    "b".repeat(63),
    "c".repeat(63),
    "d".repeat(14)
  ].join(".");
}
