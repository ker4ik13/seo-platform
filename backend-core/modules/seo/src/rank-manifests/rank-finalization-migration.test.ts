import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260729190000_rank_check_finalization_receipts/migration.sql",
  import.meta.url
);

test("finalization migration is additive, transactional and fail-closed", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  assert.match(
    sql,
    /LOCK TABLE "rank_execution_manifests"\s+IN ACCESS EXCLUSIVE MODE/u
  );
  assert.match(
    sql,
    /IF EXISTS \(\s*SELECT 1\s*FROM "rank_execution_manifests"\s*\)[\s\S]*requires an empty manifest table/u
  );
  assert.match(
    sql,
    /ADD COLUMN "estimate_expires_at" TIMESTAMPTZ\(6\) NOT NULL/u
  );
  assert.match(
    sql,
    /CHECK \("estimate_expires_at" > "sealed_at"\)/u
  );
  assert.match(
    sql,
    /CREATE TABLE "rank_check_finalization_receipts"/u
  );
  assert.match(
    sql,
    /FOREIGN KEY \(\s*"workspace_id",\s*"project_id",\s*"manifest_id",\s*"job_id"\s*\)/u
  );
  assert.doesNotMatch(sql, /ON DELETE CASCADE/u);
  assert.doesNotMatch(sql, /ON UPDATE CASCADE/u);
});

test("finalization receipt is immutable and currently zero-result only", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /"schema_version" = 'rank-finalize@1'/u
  );
  assert.match(sql, /octet_length\("request_hash"\) = 32/u);
  assert.match(
    sql,
    /"status" IN \('CANCELLED', 'FAILED', 'ACTION_REQUIRED'\)/u
  );
  assert.match(sql, /"persisted_count" = 0/u);
  assert.match(sql, /"found_count" = 0/u);
  assert.match(sql, /"not_found_count" = 0/u);
  assert.match(sql, /"missing_count" = "pair_count"/u);
  assert.match(
    sql,
    /CREATE TRIGGER "rank_check_finalization_receipts_immutable"[\s\S]*BEFORE INSERT OR UPDATE OR DELETE/u
  );
  assert.match(
    sql,
    /CREATE TRIGGER "rank_check_finalization_receipts_no_truncate"/u
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER\s+"rank_execution_manifests_finalized_at_commit"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u
  );
  assert.match(
    sql,
    /NEW\."status" = 'CLOSED'[\s\S]*NOT EXISTS \([\s\S]*FROM "rank_check_finalization_receipts"/u
  );
});
