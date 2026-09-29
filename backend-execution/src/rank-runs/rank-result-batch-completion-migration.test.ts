import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank results complete as one fenced Job batch", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260929234000_rank_result_batch_completion/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /CREATE FUNCTION public\.complete_rank_staged_results_batch/u);
  assert.match(sql, /jsonb_array_length\(p_claims\) NOT BETWEEN 1 AND 16/u);
  assert.match(sql, /FROM public\.jobs job[\s\S]*FOR UPDATE/u);
  assert.match(sql, /UPDATE public\.rank_connector_executions execution[\s\S]*FROM claims claim/u);
  assert.match(sql, /IF jsonb_array_length\(v_completed\) <> v_expected_count/u);
  assert.match(sql, /UPDATE public\.jobs job[\s\S]*"progress_current"/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.complete_rank_staged_results_batch/u);
  const grants = await readFile(new URL(
    "../../../infrastructure/postgres/permissions/service-runtime.sql",
    import.meta.url
  ), "utf8");
  assert.match(grants, /complete_rank_staged_results_batch\(uuid,uuid,jsonb,boolean\)/u);
});
