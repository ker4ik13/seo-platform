import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank submit removes only the redundant unlocked graph join", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20261005070000_rank_targeted_submit_pk_only_graph/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /WITH target_execution AS MATERIALIZED/u);
  assert.match(sql, /FROM public\.rank_connector_executions execution/u);
  assert.match(sql, /execution\."id" = p_execution_id/u);
  assert.match(sql, /execution\."authorization_expires_at" >/u);
  assert.match(sql, /rank-connector-claim:job-lock/u);
  assert.match(sql, /rank-connector-claim:execution/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION/u);
});
