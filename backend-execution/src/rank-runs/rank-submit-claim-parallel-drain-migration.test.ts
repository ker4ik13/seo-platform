import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260805104000_rank_submit_claim_parallel_drain/migration.sql",
  import.meta.url
);

test("serializes only rank capacity claims so concurrent workers drain the provider window", async () => {
  const sql = await readFile(migration, "utf8");

  assert.match(sql, /PERFORM pg_advisory_xact_lock\(/u);
  assert.doesNotMatch(sql, /pg_try_advisory_xact_lock/u);
  assert.match(sql, /active_provider_tasks >= 5/u);
  assert.match(sql, /public\.claim_rank_connector_execution\(/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.claim_rank_connector_submit_bounded/u);
});
