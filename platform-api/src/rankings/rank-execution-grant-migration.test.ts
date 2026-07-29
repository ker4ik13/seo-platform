import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260729230000_rank_execution_grant_receipts/migration.sql",
  import.meta.url
);

test("rank grant migration is transactional and creates bounded receipts", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  assert.match(
    sql,
    /CREATE TABLE "rank_execution_grant_receipts"/u
  );
  assert.match(
    sql,
    /octet_length\("request_hash"\) = 32/u
  );
  assert.match(sql, /octet_length\("scope_hash"\) = 32/u);
  assert.match(
    sql,
    /"idempotency_key" ~ '\^\[A-Za-z0-9\._:-\]\{16,180\}\$'/u
  );
  assert.match(
    sql,
    /"correlation_id" ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,99\}\$'/u
  );
  assert.match(
    sql,
    /isfinite\("decided_at"\)[\s\S]*"expires_at" IS NULL OR isfinite\("expires_at"\)[\s\S]*isfinite\("created_at"\)/u
  );
  assert.match(
    sql,
    /pg_column_size\("request_snapshot"\) <= 65536/u
  );
  assert.match(
    sql,
    /pg_column_size\("response_snapshot"\) <= 65536/u
  );
});

test("rank grant receipts enforce exact idempotency, scope and TTL", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "rank_execution_grants_workspace_idempotency_key"[\s\S]*"workspace_id"[\s\S]*"idempotency_scope"[\s\S]*"idempotency_key"/u
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "rank_execution_grants_item_attempt_key"[\s\S]*"workspace_id"[\s\S]*"job_item_id"[\s\S]*"execution_attempt"/u
  );
  assert.match(
    sql,
    /"decision" = 'GRANTED'[\s\S]*"denial_reason" IS NULL[\s\S]*"expires_at" IS NOT NULL[\s\S]*"expires_at" = "decided_at" \+ INTERVAL '30 seconds'[\s\S]*"quota_reservation_id" IS NOT NULL/u
  );
  assert.match(
    sql,
    /"decision" = 'DENIED'[\s\S]*"denial_reason" IS NOT NULL[\s\S]*"expires_at" IS NULL/u
  );
  assert.doesNotMatch(sql, /GRANT_REPLAY_EXPIRED/u);
});

test("rank grant receipts are immutable and keep external IDs opaque", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  for (const trigger of [
    "rank_execution_grant_receipt_immutable",
    "rank_execution_grant_receipt_no_truncate"
  ]) {
    assert.match(sql, new RegExp(`"${trigger}"`, "u"));
  }
  assert.match(
    sql,
    /BEFORE UPDATE OR DELETE ON "rank_execution_grant_receipts"/u
  );
  assert.match(
    sql,
    /BEFORE TRUNCATE ON "rank_execution_grant_receipts"/u
  );
  assert.doesNotMatch(sql, /FOREIGN KEY/u);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/u);
  assert.doesNotMatch(sql, /credential_id|binding_id|provider_payload/iu);
});
