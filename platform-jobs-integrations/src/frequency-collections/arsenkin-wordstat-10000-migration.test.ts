import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260802140000_arsenkin_wordstat_10000/migration.sql",
  import.meta.url
);

test("10,000-keyword Wordstat migration keeps one provider task and bounded settlement", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /'BETWEEN 1 AND 200',[\s\S]*'BETWEEN 1 AND 10000'/u);
  assert.match(sql, /mark_frequency_collection_batch_submitting/u);
  assert.match(sql, /renew_frequency_collection_batch_lease/u);
  assert.match(sql, /expected_count NOT BETWEEN 1 AND 10000/gu);
  assert.match(sql, /hashtextextended\('seo-platform:arsenkin-rank-submit', 0\)/gu);
  assert.match(sql, /active_provider_tasks >= 5/gu);
  assert.match(sql, /frequency_job\.status = 'ACTION_REQUIRED'[\s\S]*provider_request_id ~ '\^submitting:'/gu);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
});

test("capacity deferral restores the attempt and ambiguous submit is fail-closed", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(
    sql,
    /CREATE FUNCTION public\.defer_frequency_collection_batch_capacity[\s\S]*attempt = attempt - 1/u
  );
  assert.match(
    sql,
    /CREATE FUNCTION public\.quarantine_frequency_collection_batch_submit[\s\S]*provider_request_id ~ '\^submitting:/u
  );
  assert.match(
    sql,
    /SET status = 'ACTION_REQUIRED',[\s\S]*'manualReconciliationRequired', true/u
  );
  assert.match(sql, /stage = 'submit_ambiguous'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*quarantine_frequency_collection_batch_submit/u);
});
