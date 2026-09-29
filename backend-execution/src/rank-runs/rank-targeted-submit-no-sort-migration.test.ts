import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exact-ID rank claim does not recount all active executions for ordering", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260929223500_rank_targeted_submit_no_sort/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /claim_rank_connector_execution_pre_authorization_targeted/u);
  assert.match(sql, /old_order\) <> 1/u);
  assert.match(sql, /ORDER BY execution\."created_at", execution\."id"/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION/u);
});
