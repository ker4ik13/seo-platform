import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260929230000_rank_poll_candidate_prefetch/migration.sql",
  import.meta.url
);

test("poll ID prefetch keeps the canonical targeted lease claim", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /CREATE FUNCTION public\.list_rank_connector_poll_candidates/u);
  assert.match(sql, /CREATE FUNCTION[\s\S]*p_excluded UUID\[\]/u);
  assert.match(sql, /p_limit NOT BETWEEN 1 AND 30/u);
  assert.match(sql, /ROW_NUMBER\(\) OVER[\s\S]*PARTITION BY execution\.credential_id/u);
  assert.match(sql, /p_execution_id uuid/u);
  assert.match(sql, /old_candidate\) <> 2/u);
  assert.match(sql, /AND execution\.id = p_execution_id/u);
  assert.match(sql, /old_terminal\) <> 1/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.claim_rank_connector_poll_targeted/u);
});
