import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260802151000_frequency_submit_lock_fairness/migration.sql",
  import.meta.url
);

test("Wordstat submit waits briefly instead of starving behind synchronized rank ticks", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /pg_try_advisory_xact_lock/u);
  assert.match(sql, /set_config\(''lock_timeout'', ''2000ms'', TRUE\)/u);
  assert.match(sql, /PERFORM pg_advisory_xact_lock/u);
  assert.match(sql, /WHEN lock_not_available THEN RETURN/u);
  assert.match(sql, /seo-platform:arsenkin-rank-submit/u);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
});
