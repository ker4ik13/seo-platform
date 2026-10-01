import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const composePath = fileURLToPath(new URL("../worker.compose.yml", import.meta.url));
const dockerfilePath = fileURLToPath(new URL("../docker/backend.Dockerfile", import.meta.url));
const dockerignorePath = fileURLToPath(new URL("../../.dockerignore", import.meta.url));
const gitignorePath = fileURLToPath(new URL("../../.gitignore", import.meta.url));

test("remote worker Compose requires its own environment token without mounting a database", async () => {
  const compose = await readFile(composePath, "utf8");
  const dockerfile = await readFile(dockerfilePath, "utf8");
  assert.match(compose, /WORKER_NODE_TOKEN: \$\{WORKER_NODE_TOKEN:\?/u);
  assert.match(compose, /target: remote-worker/u);
  assert.doesNotMatch(compose, /WORKER_NODE_TOKEN_FILE|WORKER_NODE_TOKEN_SOURCE/u);
  assert.doesNotMatch(compose, /DATABASE_URL|REDIS_.*PASSWORD|NATS_.*PASSWORD/u);
  assert.match(dockerfile, /FROM runtime AS remote-worker\s+CMD \["node", "dist\/remote-worker\.main\.js"\]/u);
  assert.match(await readFile(dockerignorePath, "utf8"), /^infrastructure\.env\.worker$/mu);
  assert.match(await readFile(gitignorePath, "utf8"), /^infrastructure\.env\.worker$/mu);
});
