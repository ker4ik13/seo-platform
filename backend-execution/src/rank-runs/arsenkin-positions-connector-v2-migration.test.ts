import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("activates positions v2 only after old resumable executions settle", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260802090000_arsenkin_positions_connector_v2/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    migration,
    /execution_connector_version" = 'arsenkin-positions@1\.0\.0'[\s\S]*"status" IN/u
  );
  assert.match(
    migration,
    /"execution_connector_version" = 'arsenkin-positions@2\.0\.0'/u
  );
  assert.match(migration, /"kill_switch_version" = 'arsenkin-positions@3'/u);
  assert.match(
    migration,
    /Arsenkin positions v2 activation precondition failed/u
  );
});
