import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("activates the 15k positions policy as a new immutable control generation", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260802182100_arsenkin_positions_policy_v2_control/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /legacy executions to settle/u);
  assert.match(
    sql,
    /"provider_policy_version" = 'manual-arsenkin-positions@2\.0\.0'/u
  );
  assert.match(
    sql,
    /"kill_switch_version" = 'arsenkin-positions@4'/u
  );
  assert.match(sql, /"version" = 4/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
