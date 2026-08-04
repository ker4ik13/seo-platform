import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260802120000_arsenkin_wordstat_batch_runtime/migration.sql",
  import.meta.url
);

test("Arsenkin Wordstat batch runtime claims one provider task group atomically", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(
    sql,
    /CREATE FUNCTION public\.claim_frequency_collection_batch\([\s\S]*p_max_batch_items INTEGER/u
  );
  assert.match(sql, /p_max_batch_items NOT BETWEEN 1 AND 200/u);
  assert.match(sql, /first_row\."provider" = 'ARSENKIN'/u);
  assert.match(
    sql,
    /first_row\."providerRequestId" IS NULL[\s\S]*item\.provider_request_id IS NULL[\s\S]*OR item\.provider_request_id = first_row\."providerRequestId"/u
  );
  assert.match(sql, /LIMIT \(p_max_batch_items - 1\)/u);
  assert.match(sql, /attempt = attempt \+ 1/u);
  assert.match(sql, /FOR UPDATE OF item SKIP LOCKED/u);
});

test("batch settlement is exact, tenant-bound, leased, and fail-closed", async () => {
  const sql = await readFile(migration, "utf8");
  for (const functionName of [
    "complete_frequency_collection_batch",
    "defer_frequency_collection_batch",
    "fail_frequency_collection_batch"
  ]) {
    assert.match(sql, new RegExp(`CREATE FUNCTION public\\.${functionName}`, "u"));
  }
  assert.match(sql, /item\.workspace_id = job_row\.workspace_id/gu);
  assert.match(sql, /item\.project_id = job_row\.project_id/gu);
  assert.match(sql, /job\.lease_owner = p_lease_owner/gu);
  assert.match(sql, /job\.lease_expires_at > clock_timestamp\(\)/gu);
  assert.match(sql, /job\.version = p_job_version/gu);
  assert.match(sql, /matched_count <> expected_count/gu);
  assert.match(sql, /BOOL_AND\(item\.attempt < job_row\.max_attempts\)/u);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
  assert.equal((sql.match(/REVOKE ALL ON FUNCTION/gu) ?? []).length, 4);
});
