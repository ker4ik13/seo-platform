import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedEnvironment = [
  "DATABASE_POOL_MAX",
  "DATABASE_URL",
  "INTEGRATION_CREDENTIAL_ROLE",
  "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN",
  "JOBS_TO_SEO_RANK_RESULT_TOKEN",
  "JOBS_TO_SEO_RANK_TOKEN",
  "PLATFORM_API_COMMAND_TIMEOUT_MS",
  "PLATFORM_API_URL",
  "RANK_PREPARATION_CONCURRENCY",
  "RANK_PREPARATION_DISPATCH_SECONDS",
  "RANK_PREPARATION_ENABLED",
  "RANK_PREPARATION_LEASE_SECONDS",
  "RANK_PROVIDER_KILL_SWITCH_VERSION",
  "RANK_PROVIDER_SUBMIT_ENABLED",
  "REDIS_URL",
  "SEO_DATA_COMMAND_TIMEOUT_MS",
  "SEO_DATA_URL"
];

function serviceBlock(compose, serviceName) {
  const lines = compose.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(start, -1, `${serviceName} service must exist`);

  const end = lines.findIndex(
    (line, index) =>
      index > start && /^  [a-z0-9][a-z0-9-]*:\s*$/u.test(line)
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function nestedBlock(service, key) {
  const lines = service.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `    ${key}:`);
  assert.notEqual(start, -1, `${key} block must exist`);

  const end = lines.findIndex(
    (line, index) =>
      index > start && /^    [a-z_][a-z0-9_-]*:/u.test(line)
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

test("rank worker has an explicit least-capability runtime boundary", async () => {
  const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);
  const compose = await readFile(composeUrl, "utf8");
  const rankWorker = serviceBlock(compose, "rank-worker");
  const environment = nestedBlock(rankWorker, "environment");
  const environmentKeys = [...environment.matchAll(
    /^      ([A-Z][A-Z0-9_]*):/gmu
  )].map((match) => match[1]).sort();

  assert.deepEqual(environmentKeys, expectedEnvironment);
  assert.match(rankWorker, /command: \["node", "dist\/rank-worker\.main\.js"\]/u);
  assert.match(
    environment,
    /DATABASE_URL: postgresql:\/\/jobs_rank_runtime:\$\{JOBS_RANK_DATABASE_PASSWORD:\?JOBS_RANK_DATABASE_PASSWORD is required\}@postgres:5432\/jobs_db/u
  );
  assert.doesNotMatch(environment, /JOBS_DATABASE_PASSWORD/u);
  assert.match(environment, /RANK_PREPARATION_ENABLED: "true"/u);
  assert.match(environment, /RANK_PROVIDER_SUBMIT_ENABLED: "false"/u);
  assert.match(
    environment,
    /RANK_PROVIDER_KILL_SWITCH_VERSION: \$\{RANK_PROVIDER_KILL_SWITCH_VERSION:-arsenkin-positions@2\}/u
  );
  assert.match(environment, /INTEGRATION_CREDENTIAL_ROLE: DISABLED/u);
  assert.match(environment, /PLATFORM_API_URL: http:\/\/platform-api:4000/u);
  assert.match(
    environment,
    /PLATFORM_API_COMMAND_TIMEOUT_MS: \$\{PLATFORM_API_COMMAND_TIMEOUT_MS:-5000\}/u
  );
  assert.match(
    environment,
    /JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: \$\{JOBS_TO_PLATFORM_RANK_GRANT_TOKEN:\?JOBS_TO_PLATFORM_RANK_GRANT_TOKEN is required\}/u
  );

  for (const forbidden of [
    "INTERNAL_API_TOKEN",
    "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
    "RANK_HISTORY_CURSOR_KEY",
    "INTEGRATION_CREDENTIAL_KEYS",
    "INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS",
    "NATS_URL",
    "NATS_USER",
    "NATS_PASSWORD",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "SMTP_USER",
    "SMTP_PASSWORD"
  ]) {
    assert.doesNotMatch(environment, new RegExp(`\\b${forbidden}:`, "u"));
  }

  assert.doesNotMatch(rankWorker, /^    (?:expose|ports):/mu);
});

test("rank worker is bounded, internal-only and starts after required dependencies", async () => {
  const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);
  const compose = await readFile(composeUrl, "utf8");
  const rankWorker = serviceBlock(compose, "rank-worker");
  const networks = nestedBlock(rankWorker, "networks");
  const dependencies = nestedBlock(rankWorker, "depends_on");
  const healthcheck = nestedBlock(rankWorker, "healthcheck");

  assert.match(networks, /^      - internal$/mu);
  assert.match(networks, /^      - jobs-redis$/mu);
  assert.doesNotMatch(networks, /\b(?:edge|outbound)\b/u);
  assert.match(
    dependencies,
    /jobs-runtime-db-permissions:\n        condition: service_completed_successfully/u
  );
  assert.match(
    dependencies,
    /redis-jobs:\n        condition: service_healthy/u
  );
  assert.match(dependencies, /seo-data:\n        condition: service_healthy/u);
  assert.match(dependencies, /platform-api:\n        condition: service_healthy/u);
  assert.doesNotMatch(dependencies, /\bnats:/u);
  assert.match(healthcheck, /\[r\]ank-worker\.main\.js/u);
  assert.match(rankWorker, /^    cpus: /mu);
  assert.match(rankWorker, /^    mem_limit: /mu);
  assert.match(rankWorker, /^    pids_limit: /mu);
});
