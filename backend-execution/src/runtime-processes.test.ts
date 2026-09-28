import assert from "node:assert/strict";
import test from "node:test";
import { executionProcessDefinitions } from "./runtime-processes.js";

const baseEnvironment = {
  NODE_ENV: "production",
  EXECUTION_HTTP_DATABASE_URL: "postgresql://http",
  EXECUTION_HTTP_REDIS_URL: "redis://http",
  EXECUTION_SYSTEM_REDIS_URL: "redis://system",
  EXECUTION_IMPORT_DATABASE_URL: "postgresql://import",
  EXECUTION_IMPORT_REDIS_URL: "redis://import",
  EXECUTION_RANK_DATABASE_URL: "postgresql://rank",
  EXECUTION_RANK_REDIS_URL: "redis://rank",
  EXECUTION_CRAWL_DATABASE_URL: "postgresql://crawl",
  EXECUTION_CRAWL_REDIS_URL: "redis://crawl",
  EXECUTION_CONNECTOR_DATABASE_URL: "postgresql://connector",
  EXECUTION_CONNECTOR_REDIS_URL: "redis://connector",
  INTEGRATION_CREDENTIAL_KEYS: "secret-keyring",
  INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS: "secret-fingerprint",
  OPERATIONAL_ALERT_TOKEN: "must-stay-in-supervisor",
  TELEGRAM_ALERT_BOT_TOKEN: "must-not-enter-execution-child",
  PLATFORM_API_URL: "http://backend-core:4000",
  PLATFORM_API_COMMAND_TIMEOUT_MS: "7000",
  JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN:
    "billing-settlement-secret",
  PLATFORM_XMLSTOCK_ENABLED: "true",
  PLATFORM_XMLSTOCK_API_KEYS: "must-stay-in-http-1,must-stay-in-http-2",
  PLATFORM_XMLSTOCK_ACCOUNT_IDS: "platform-account-1,platform-account-2",
  PLATFORM_XMLSTOCK_SOFT_ID: "a".repeat(32),
  PLATFORM_ARSENKIN_ENABLED: "false",
  PLATFORM_ARSENKIN_API_KEYS: "staged-must-stay-in-http",
  RANK_CONNECTOR_CONCURRENCY: "16",
  UPLOAD_FILE_RETENTION_DAYS: "14",
  EXPORT_FILE_RETENTION_DAYS: "3",
  RANK_RESULT_PERSISTENCE_DISPATCH_INTERVAL_MS: "750"
} satisfies NodeJS.ProcessEnv;

test("execution roles receive only their scoped database and secrets", () => {
  const definitions = executionProcessDefinitions(baseEnvironment);
  assert.deepEqual(definitions.map(({ name }) => name), [
    "http",
    "system-worker",
    "import-worker",
    "rank-worker",
    "crawl-worker",
    "connector-worker",
    "connector-worker-2",
    "connector-worker-3"
  ]);
  const system = definitions.find(({ name }) => name === "system-worker")?.environment;
  assert.equal(system?.DATABASE_URL, undefined);
  assert.equal(system?.REDIS_URL, "redis://system");
  const http = definitions.find(({ name }) => name === "http")?.environment;
  assert.equal(http?.PLATFORM_API_URL, "http://backend-core:4000");
  assert.equal(http?.PLATFORM_API_COMMAND_TIMEOUT_MS, "7000");
  assert.equal(http?.PLATFORM_XMLSTOCK_ENABLED, "true");
  assert.equal(http?.PLATFORM_XMLSTOCK_SOFT_ID, "a".repeat(32));
  assert.equal(
    http?.PLATFORM_XMLSTOCK_API_KEYS,
    "must-stay-in-http-1,must-stay-in-http-2"
  );
  assert.equal(system?.PLATFORM_API_URL, undefined);
  const importWorker = definitions.find(({ name }) => name === "import-worker")?.environment;
  assert.equal(importWorker?.UPLOAD_FILE_RETENTION_DAYS, "14");
  assert.equal(importWorker?.EXPORT_FILE_RETENTION_DAYS, "3");
  assert.equal(http?.UPLOAD_FILE_RETENTION_DAYS, undefined);
  const rank = definitions.find(({ name }) => name === "rank-worker")?.environment;
  assert.equal(rank?.DATABASE_URL, "postgresql://rank");
  assert.equal(
    rank?.RANK_RESULT_PERSISTENCE_DISPATCH_INTERVAL_MS,
    "750"
  );
  assert.equal(rank?.INTEGRATION_CREDENTIAL_KEYS, undefined);
  assert.equal(rank?.RANK_CONNECTOR_CONCURRENCY, "16");
  assert.equal(rank?.CONNECTOR_RUNTIME_SHARD_COUNT, "3");
  const connector = definitions.find(({ name }) => name === "connector-worker")?.environment;
  const secondaryConnector = definitions.find(
    ({ name }) => name === "connector-worker-2"
  )?.environment;
  assert.equal(connector?.DATABASE_URL, "postgresql://connector");
  assert.equal(connector?.INTEGRATION_CREDENTIAL_KEYS, "secret-keyring");
  assert.equal(
    connector?.JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN,
    "billing-settlement-secret"
  );
  assert.equal(connector?.CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS, undefined);
  assert.equal(connector?.CONNECTOR_MAINTENANCE_ENABLED, "true");
  assert.equal(secondaryConnector?.CONNECTOR_MAINTENANCE_ENABLED, "false");
  assert.equal(connector?.CONNECTOR_RUNTIME_SHARD_INDEX, "0");
  assert.equal(secondaryConnector?.CONNECTOR_RUNTIME_SHARD_INDEX, "1");
  assert.equal(connector?.CONNECTOR_RUNTIME_SHARD_COUNT, "3");
  assert.equal(secondaryConnector?.CONNECTOR_RUNTIME_SHARD_COUNT, "3");
  assert.equal(connector?.PLATFORM_XMLSTOCK_SOFT_ID, "a".repeat(32));
  assert.equal(secondaryConnector?.PLATFORM_XMLSTOCK_SOFT_ID, "a".repeat(32));
  assert.equal(rank?.PLATFORM_XMLSTOCK_SOFT_ID, undefined);
  assert.equal(
    connector?.RANK_RESULT_PERSISTENCE_DISPATCH_INTERVAL_MS,
    undefined
  );
  assert.equal(
    connector?.INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS,
    undefined
  );
  for (const definition of definitions) {
    assert.equal(definition.environment.OPERATIONAL_ALERT_TOKEN, undefined);
    assert.equal(definition.environment.TELEGRAM_ALERT_BOT_TOKEN, undefined);
    if (definition.name !== "http") {
      assert.equal(
        definition.environment.PLATFORM_XMLSTOCK_API_KEY,
        undefined
      );
      assert.equal(
        definition.environment.PLATFORM_XMLSTOCK_API_KEYS,
        undefined
      );
      assert.equal(
        definition.environment.PLATFORM_ARSENKIN_API_KEY,
        undefined
      );
      assert.equal(
        definition.environment.PLATFORM_ARSENKIN_API_KEYS,
        undefined
      );
    }
    if (!definition.name.startsWith("connector-worker")) {
      assert.equal(
        definition.environment.JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN,
        undefined
      );
    }
  }
});

test("rank and connector process counts scale without adding services", () => {
  const definitions = executionProcessDefinitions({
    ...baseEnvironment,
    RANK_WORKER_PROCESSES: "3",
    CONNECTOR_WORKER_PROCESSES: "4"
  });
  assert.equal(
    definitions.filter(({ name }) => name.startsWith("rank-worker")).length,
    3
  );
  assert.equal(
    definitions.filter(({ name }) => name.startsWith("connector-worker")).length,
    4
  );
  for (const rank of definitions.filter(({ name }) =>
    name.startsWith("rank-worker")
  )) {
    assert.equal(rank.environment.RANK_CONNECTOR_CONCURRENCY, "16");
    assert.equal(rank.environment.CONNECTOR_RUNTIME_SHARD_COUNT, "4");
  }
});

test("optional inspection and email roles are explicit", () => {
  const definitions = executionProcessDefinitions({
    ...baseEnvironment,
    INSPECTION_WORKER_ENABLED: "true",
    EXECUTION_INSPECTION_DATABASE_URL: "postgresql://inspection",
    EXECUTION_INSPECTION_REDIS_URL: "redis://inspection",
    EMAIL_ENABLED: "true",
    EXECUTION_AUTH_EMAIL_DATABASE_URL: "postgresql://email",
    EXECUTION_AUTH_EMAIL_NATS_USER: "email-user",
    EXECUTION_AUTH_EMAIL_NATS_PASSWORD: "email-password"
  });
  assert.deepEqual(definitions.slice(-2).map(({ name }) => name), [
    "inspection-worker",
    "auth-email-worker"
  ]);
});
