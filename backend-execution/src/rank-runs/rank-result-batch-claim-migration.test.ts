import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank persistence claims sixteen fenced results in one set-based transaction", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260929231000_rank_result_batch_claim/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /CREATE FUNCTION public\.claim_rank_staged_results/u);
  assert.match(sql, /p_max_batch_items NOT BETWEEN 1 AND 16/u);
  assert.match(sql, /seo-platform:rank-result-persistence/u);
  assert.match(sql, /FOR UPDATE OF execution SKIP LOCKED[\s\S]*LIMIT p_max_batch_items/u);
  assert.match(sql, /UPDATE public\.rank_connector_executions execution[\s\S]*RETURNING execution\.\*/u);
  assert.match(sql, /lease_token = pg_catalog\.uuidv7\(\)/u);
  assert.match(sql, /intent\.request_hash = execution\.provider_request_intent_hash/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.claim_rank_staged_results/u);
  assert.doesNotMatch(sql, /FOR [a-z_]+ IN 1\.\.p_max_batch_items/u);
});
