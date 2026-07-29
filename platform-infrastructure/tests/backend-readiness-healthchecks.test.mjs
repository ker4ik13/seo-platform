import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backendPorts = new Map([
  ["platform-api", 4000],
  ["seo-data", 4001],
  ["jobs-integrations", 4002],
  ["realtime", 4003]
]);

test("backend container healthchecks use dependency-aware readiness", async () => {
  const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);
  const compose = await readFile(composeUrl, "utf8");

  for (const [serviceName, port] of backendPorts) {
    const healthcheck = nestedBlock(
      serviceBlock(compose, serviceName),
      "healthcheck"
    );

    assert.match(
      healthcheck,
      new RegExp(
        `fetch\\('http://127\\.0\\.0\\.1:${port}/health/ready'\\)`,
        "u"
      ),
      `${serviceName} must be removed from rotation when a required dependency is unavailable`
    );
    assert.doesNotMatch(
      healthcheck,
      /\/health\/live/u,
      `${serviceName} healthcheck must not use liveness`
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
