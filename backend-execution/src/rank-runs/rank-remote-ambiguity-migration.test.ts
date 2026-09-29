import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("expired remote rank lease gets only one automatic same-page recovery", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260929235500_remote_rank_ambiguity_budget/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /remote_unknown_retries BETWEEN 0 AND 1/u);
  assert.match(sql, /execution\.remote_unknown_retries >= 1/u);
  assert.match(sql, /WHEN execution\.status = ''POLL_WAIT'' THEN 0/u);
  assert.match(sql, /WHEN execution\.lease_owner LIKE ''remote:%'' THEN 1/u);
  assert.match(sql, /REMOTE_WORKER_OUTCOME_UNKNOWN/u);
  assert.match(sql, /claim_rank_connector_poll_targeted/u);
});
