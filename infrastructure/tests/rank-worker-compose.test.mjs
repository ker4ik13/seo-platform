import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank work is a scoped child role of backend-execution", async () => {
  const [compose, runtime] = await Promise.all([
    readFile(new URL("../compose.dokploy.yml", import.meta.url), "utf8"),
    readFile(
      new URL("../../backend-execution/src/runtime-processes.ts", import.meta.url),
      "utf8"
    )
  ]);

  assert.doesNotMatch(compose, /^  rank-worker:$/mu);
  const execution = serviceBlock(compose, "backend-execution");
  assert.match(
    execution,
    /EXECUTION_RANK_DATABASE_URL: postgresql:\/\/jobs_rank_runtime:/u
  );
  assert.match(
    execution,
    /EXECUTION_RANK_REDIS_URL: redis:\/\/seo_jobs_rank:/u
  );
  assert.match(execution, /JOBS_TO_PLATFORM_RANK_GRANT_TOKEN:/u);
  assert.match(execution, /JOBS_TO_SEO_RANK_RESULT_TOKEN:/u);

  assert.match(
    runtime,
    /repeatedDefinitions\([\s\S]*?"rank-worker",[\s\S]*?"\.\/rank-worker\.main\.js",[\s\S]*?RANK_KEYS/u
  );
  assert.match(runtime, /RANK_WORKER_PROCESSES/u);
  assert.match(runtime, /CONNECTOR_WORKER_PROCESSES/u);
  assert.match(runtime, /RANK_PREPARATION_ENABLED: "true"/u);
  assert.match(runtime, /RANK_PROVIDER_SUBMIT_ENABLED: "false"/u);
  assert.match(runtime, /INTEGRATION_CREDENTIAL_ROLE: "DISABLED"/u);
  assert.doesNotMatch(
    runtime.slice(
      runtime.indexOf("const RANK_KEYS"),
      runtime.indexOf("const CRAWL_KEYS")
    ),
    /INTEGRATION_CREDENTIAL_KEYS/u
  );
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
