import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("targeted submit anchors the full graph to one indexed execution", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260929232000_rank_targeted_submit_pk_anchor/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /WITH target_execution AS MATERIALIZED \([\s\S]*WHERE id = p_execution_id/u);
  assert.match(sql, /FROM target_execution execution/u);
  assert.match(sql, /old_candidate\) <> 1/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION/u);
});
