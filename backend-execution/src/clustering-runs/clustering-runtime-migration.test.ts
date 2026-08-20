import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260820130000_arsenkin_clustering_runtime/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const permissions = readFileSync(
  new URL("../../../infrastructure/postgres/permissions/jobs-connector.sql", import.meta.url),
  "utf8"
);

test("keeps clustering execution behind tenant-scoped fenced broker functions", () => {
  for (const routine of [
    "claim_clustering_run",
    "renew_clustering_run_lease",
    "mark_clustering_run_submitting",
    "transition_clustering_run"
  ]) {
    assert.match(migration, new RegExp(`CREATE FUNCTION public\\.${routine}\\(`, "u"));
    assert.match(permissions, new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${routine}\\(`, "u"));
  }
  assert.match(migration, /SECURITY DEFINER/gu);
  assert.match(migration, /SET search_path = pg_catalog, pg_temp/gu);
  assert.match(migration, /job\.workspace_id = credential\.workspace_id|credential\.workspace_id = job_row\.workspace_id/u);
  assert.match(migration, /binding\.project_id = job_row\.project_id/u);
  assert.match(migration, /job\.version = p_job_version/gu);
  assert.match(migration, /hashtextextended\('seo-platform:rank-dispatch:ARSENKIN', 0\)/u);
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
});

test("shares all five Arsenkin provider slots and quarantines ambiguous submits", () => {
  assert.match(migration, /active_provider_tasks >= 5/u);
  assert.match(
    migration,
    /provider_job\.type IN \('FREQUENCY_COLLECTION', 'AI_ANSWER_COLLECTION', 'CLUSTERING_RUN'\)/u
  );
  assert.match(migration, /p_action = 'QUARANTINE'/u);
  assert.match(migration, /PROVIDER_TRANSPORT_AMBIGUOUS/u);
  assert.match(migration, /manualReconciliationRequired', true/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_clustering_run/u);
});

test("requires an immutable complete item set for the single provider task", () => {
  assert.match(migration, /expected_count::BIGINT <> job_row\.progress_total/u);
  assert.match(migration, /request_id_count > 1/u);
  assert.match(migration, /COUNT\(DISTINCT COALESCE\(candidate\.provider_request_id::TEXT, '__NULL__'\)\)/u);
  assert.match(migration, /item\.input_reference->>'version'/u);
});
