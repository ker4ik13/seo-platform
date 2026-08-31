import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all application containers use dependency-aware readiness", async () => {
  const compose = await readFile(
    new URL("../compose.dokploy.yml", import.meta.url),
    "utf8"
  );

  const core = serviceBlock(compose, "backend-core");
  const execution = serviceBlock(compose, "backend-execution");
  for (const service of [core, execution]) {
    const healthcheck = nestedBlock(service, "healthcheck");
    assert.match(healthcheck, /\/health\/ready/u);
    assert.doesNotMatch(healthcheck, /\/health\/live/u);
  }

  assert.match(core, /^      - "4000"$/mu);
  assert.match(core, /^      - "4001"$/mu);
  assert.match(core, /^      - "4003"$/mu);
  assert.match(core, /^      - "4004"$/mu);
  assert.match(core, /Promise\.all\(\[4000,4003,4004\]/u);
  assert.match(execution, /^    stop_grace_period: 75s$/mu);
  assert.match(
    execution,
    /^      backend-core:\n(?:        #.*\n)*        condition: service_started/mu,
    "execution must start before Core can report its execution dependency ready"
  );
  assert.doesNotMatch(
    execution,
    /^      backend-core:\n(?:        #.*\n)*        condition: service_healthy/mu,
    "Core and Execution readiness must not form a startup deadlock"
  );

  const frontend = serviceBlock(compose, "frontend");
  const frontendHealthcheck = nestedBlock(frontend, "healthcheck");
  assert.match(frontendHealthcheck, /127\.0\.0\.1:3000\/ru/u);
});

test("legacy application containers are absent", async () => {
  const compose = await readFile(
    new URL("../compose.dokploy.yml", import.meta.url),
    "utf8"
  );
  for (const legacy of [
    "platform-api",
    "seo-data",
    "platform-execution",
    "realtime",
    "web-push-worker",
    "auth-email-worker",
    "system-worker",
    "upload-inspection-worker",
    "import-worker",
    "rank-worker",
    "crawl-worker",
    "connector-worker",
    "web",
    "admin"
  ]) {
    assert.doesNotMatch(
      compose,
      new RegExp(`^  ${legacy}:$`, "mu"),
      `${legacy} must not be a deployable service`
    );
  }
});

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
