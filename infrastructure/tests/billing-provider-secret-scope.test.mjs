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
