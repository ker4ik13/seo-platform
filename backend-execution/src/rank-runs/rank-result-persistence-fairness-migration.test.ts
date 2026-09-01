import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260901093000_rank_result_persistence_fairness/migration.sql",
  import.meta.url
);
const rankWorker = new URL("../rank-worker.main.ts", import.meta.url);

test("rank result persistence claims fairly across workspaces and Jobs", async () => {
  const sql = await readFile(migration, "utf8");

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.claim_rank_staged_result/u);
  assert.match(
    sql,
    /pg_advisory_xact_lock\([\s\S]*seo-platform:rank-result-persistence/u
  );
  assert.doesNotMatch(sql, /pg_try_advisory_xact_lock/u);
  assert.match(sql, /WITH candidate_jobs AS MATERIALIZED/u);
  assert.match(sql, /AS "workspace_active_count"/u);
  assert.match(sql, /AS "workspace_last_progress_at"/u);
  assert.match(
    sql,
    /ORDER BY[\s\S]*fair_job\."workspace_active_count",[\s\S]*fair_job\."workspace_last_progress_at",[\s\S]*fair_job\."active_count",[\s\S]*fair_job\."updated_at"/u
  );
  assert.match(
    sql,
    /JOIN selected_job selected[\s\S]*ORDER BY execution\."created_at", execution\."id"/u
  );
  assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, pg_temp/u);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION[\s\S]*claim_rank_staged_result\(TEXT, INTEGER\)[\s\S]*FROM PUBLIC/u
  );
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
});

test("rank result persistence has a separate bounded runtime dispatcher", async () => {
  const source = await readFile(rankWorker, "utf8");

  assert.match(source, /let resultDispatching = false/u);
  assert.match(
    source,
    /Array\.from\([\s\S]*length: config\.rankPreparation\.concurrency[\s\S]*resultPersistence\.processOne/u
  );
  assert.match(
    source,
    /setInterval\([\s\S]*dispatchResults\(\)[\s\S]*config\.rankPreparation\.resultPersistenceDispatchIntervalMs/u
  );
  assert.match(source, /clearInterval\(resultDispatchTimer\)/u);
});
