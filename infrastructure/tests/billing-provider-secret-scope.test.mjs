import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseYamlMappings,
  serviceEnvironment,
  serviceNames
} from "./helpers/compose-mappings.mjs";

const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);
const rootEnvUrl = new URL("../../.env.example", import.meta.url);
const yookassaKeys = [
  "YOOKASSA_ENABLED",
  "YOOKASSA_SHOP_ID",
  "YOOKASSA_SECRET_KEY",
  "YOOKASSA_RETURN_URL",
  "YOOKASSA_API_BASE_URL",
  "YOOKASSA_REQUEST_TIMEOUT_MS",
  "YOOKASSA_VALIDATE_WEBHOOK_SOURCE_IP"
];
const reconciliationKeys = [
  "BILLING_RECONCILIATION_ENABLED",
  "BILLING_RECONCILIATION_INTERVAL_MS",
  "BILLING_RECONCILIATION_BATCH_SIZE"
];
const platformUsageKeys = [
  "PLATFORM_XMLSTOCK_ENABLED",
  "PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR",
  "PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR",
  "PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR",
  "PLATFORM_ARSENKIN_ENABLED",
  "PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR",
  "PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR",
  "PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR"
];
const platformProviderSecretKeys = [
  "PLATFORM_XMLSTOCK_API_KEYS",
  "PLATFORM_XMLSTOCK_ACCOUNT_IDS",
  "PLATFORM_XMLSTOCK_API_KEY",
  "PLATFORM_XMLSTOCK_ACCOUNT_ID",
  "PLATFORM_ARSENKIN_API_KEYS",
  "PLATFORM_ARSENKIN_API_KEY"
];

test("YooKassa credentials reach only the Platform API process", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);
  const platformApi = serviceEnvironment(document, "backend-core");

  for (const key of [...yookassaKeys, ...reconciliationKeys]) {
    assert.ok(platformApi.has(key), `platform-api must receive ${key}`);
  }
  assert.equal(
    platformApi.get("YOOKASSA_API_BASE_URL"),
    "${YOOKASSA_API_BASE_URL:-https://api.yookassa.ru/v3}"
  );

  for (const serviceName of serviceNames(document)) {
    if (serviceName === "backend-core") continue;
    const environment = serviceEnvironment(document, serviceName, false);
    assert.equal(
      environment?.has("YOOKASSA_SECRET_KEY") ?? false,
      false,
      `${serviceName} must not receive the YooKassa secret`
    );
  }
});

test("platform provider flags, prices and source credentials stay in their owning containers", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);
  const core = serviceEnvironment(document, "backend-core");
  const execution = serviceEnvironment(document, "backend-execution");
  const preflight = serviceEnvironment(document, "service-token-preflight");

  for (const key of platformUsageKeys) {
    assert.ok(core.has(key), `backend-core must receive ${key}`);
    assert.ok(preflight.has(key), `preflight must receive ${key}`);
  }
  assert.equal(core.has("PLATFORM_XMLSTOCK_API_KEY"), false);
  assert.equal(core.has("PLATFORM_XMLSTOCK_API_KEYS"), false);
  assert.equal(core.has("PLATFORM_ARSENKIN_API_KEY"), false);
  assert.equal(core.has("PLATFORM_ARSENKIN_API_KEYS"), false);
  assert.equal(
    execution.has("PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR"),
    false
  );
  assert.equal(
    execution.has("PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR"),
    false
  );
  assert.equal(
    execution.has("PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR"),
    false
  );
  assert.equal(
    execution.has("PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR"),
    false
  );

  for (const key of platformProviderSecretKeys) {
    assert.ok(execution.has(key), `backend-execution must receive ${key}`);
    assert.ok(preflight.has(key), `preflight must receive ${key}`);
    for (const serviceName of serviceNames(document)) {
      if (["backend-execution", "service-token-preflight"].includes(serviceName)) {
        continue;
      }
      const environment = serviceEnvironment(document, serviceName, false);
      assert.equal(
        environment?.has(key) ?? false,
        false,
        `${serviceName} must not receive ${key}`
      );
    }
  }
});

test("the deploy example never contains a YooKassa credential", async () => {
  const rootEnv = await readFile(rootEnvUrl, "utf8");
  assert.match(rootEnv, /^YOOKASSA_ENABLED=false$/mu);
  assert.match(rootEnv, /^YOOKASSA_SHOP_ID=$/mu);
  assert.match(rootEnv, /^YOOKASSA_SECRET_KEY=$/mu);
  assert.match(
    rootEnv,
    /^YOOKASSA_API_BASE_URL=https:\/\/api\.yookassa\.ru\/v3$/mu
  );
});

test("the deploy example keeps platform usage disabled and provider secrets empty", async () => {
  const rootEnv = await readFile(rootEnvUrl, "utf8");
  assert.match(rootEnv, /^PLATFORM_XMLSTOCK_ENABLED=false$/mu);
  assert.match(rootEnv, /^PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR=$/mu);
  assert.match(rootEnv, /^PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR=$/mu);
  assert.match(rootEnv, /^PLATFORM_XMLSTOCK_API_KEYS=$/mu);
  assert.match(rootEnv, /^PLATFORM_XMLSTOCK_ACCOUNT_IDS=$/mu);
  assert.match(rootEnv, /^PLATFORM_XMLSTOCK_API_KEY=$/mu);
  assert.match(rootEnv, /^PLATFORM_XMLSTOCK_ACCOUNT_ID=$/mu);
  assert.match(rootEnv, /^PLATFORM_ARSENKIN_ENABLED=false$/mu);
  assert.match(rootEnv, /^PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR=$/mu);
  assert.match(rootEnv, /^PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR=$/mu);
  assert.match(rootEnv, /^PLATFORM_ARSENKIN_API_KEYS=$/mu);
  assert.match(rootEnv, /^PLATFORM_ARSENKIN_API_KEY=$/mu);
});
