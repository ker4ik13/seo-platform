import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production PostgreSQL preloads nested query statistics in a private schema", async () => {
  const [compose, roles] = await Promise.all([
    readFile(new URL("../compose.dokploy.yml", import.meta.url), "utf8"),
    readFile(new URL("../postgres/roles/provision-service-database-roles.sh", import.meta.url), "utf8")
  ]);
  assert.match(compose, /shared_preload_libraries=pg_stat_statements/u);
  assert.match(compose, /pg_stat_statements\.track=all/u);
  assert.match(roles, /PGDATABASE=jobs_db psql[\s\S]*CREATE SCHEMA IF NOT EXISTS diagnostics/u);
  assert.match(roles, /REVOKE ALL ON SCHEMA diagnostics FROM PUBLIC/u);
  assert.match(roles, /CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA diagnostics/u);
});
