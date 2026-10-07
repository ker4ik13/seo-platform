import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isMapping,
  parseYamlMappings,
  resolveMapping,
  serviceNames,
  sorted
} from "./helpers/compose-mappings.mjs";

const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);

test("Dokploy Compose declares the complete service, volume and network topology", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);
  const root = resolveMapping(document.root, document);

  assert.deepEqual(sorted(serviceNames(document)), sorted([
    "postgres",
    "service-database-roles",
    "service-token-preflight",
    "redis-jobs",
    "redis-realtime",
    "nats",
    "nats-topology-provisioner",
    "clamav",
    "core-api-migrate",
    "core-seo-migrate",
    "seo-extension-db-permissions",
    "execution-migrate",
    "platform-runtime-db-permissions",
    "seo-runtime-db-permissions",
    "jobs-runtime-db-permissions",
    "jobs-connector-db-permissions",
    "core-realtime-migrate",
    "realtime-runtime-db-permissions",
    "realtime-web-push-db-permissions",
    "backend-core",
    "backend-execution",
    "frontend"
  ]));

  const volumes = root.get("volumes");
  assert.ok(isMapping(volumes), "top-level named volumes must exist");
  assert.deepEqual(
    sorted(resolveMapping(volumes, document).keys()),
    sorted(["postgres_data", "redis_jobs_data", "nats_data", "clamav_data"])
  );

  const networks = root.get("networks");
  assert.ok(isMapping(networks), "top-level networks must exist");
  assert.deepEqual(
    sorted(resolveMapping(networks, document).keys()),
    sorted(["internal", "jobs-redis", "realtime-redis", "edge", "outbound"])
  );
});

test("runtime configuration is baked into images and persistent data uses named volumes", async () => {
  const [compose, dockerfile] = await Promise.all([
    readFile(composeUrl, "utf8"),
    readFile(new URL("../docker/infra.Dockerfile", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(compose, /^\s+- \.[./]/mu);
  for (const target of [
    "postgres-runtime",
    "postgres-tooling",
    "service-token-preflight",
    "redis-runtime",
    "nats-runtime",
    "clamav-runtime"
  ]) {
    assert.match(
      dockerfile,
      new RegExp(` AS ${target.replaceAll("-", "[-]")}$`, "mu")
    );
  }
});

test("ClamAV keeps its scanner private while retaining signature-update egress", async () => {
  const [compose, clamdConfig] = await Promise.all([
    readFile(composeUrl, "utf8"),
    readFile(new URL("../clamav/clamd.conf", import.meta.url), "utf8")
  ]);
  const clamavBlock = compose.slice(
    compose.indexOf("  clamav:"),
    compose.indexOf("  core-api-migrate:")
  );

  assert.match(
    clamavBlock,
    /^    networks:\n      - internal\n      - outbound$/mu
  );
  assert.doesNotMatch(clamavBlock, /^    (?:ports|expose):/mu);
  // The official image's entrypoint waits for this socket even when TCP is healthy.
  assert.match(clamdConfig, /^LocalSocket \/run\/clamav\/clamd\.sock$/mu);
  assert.match(clamdConfig, /^TCPSocket 3310$/mu);
});
