import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260729220000_rank_result_persistence/migration.sql",
  import.meta.url
);

test("rank result migration is transactional and fails closed on legacy rows", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  assert.match(
    sql,
    /LOCK TABLE "rank_snapshots", "current_ranks"\s+IN ACCESS EXCLUSIVE MODE/u
  );
  assert.match(
    sql,
    /IF EXISTS \(SELECT 1 FROM "rank_snapshots"\)[\s\S]*OR EXISTS \(SELECT 1 FROM "current_ranks"\)[\s\S]*requires empty pre-release rank tables/u
  );
  assert.match(sql, /CREATE TABLE "rank_chunk_ingest_receipts"/u);
  assert.match(sql, /CREATE TABLE "rank_snapshots"/u);
  assert.match(sql, /CREATE TABLE "current_ranks"/u);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/u);
  assert.doesNotMatch(sql, /ON UPDATE CASCADE/u);
});

test("rank result migration enforces tenant provenance and immutable receipts", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  for (const constraint of [
    "rank_chunk_ingest_receipts_manifest_tenant_fkey",
    "rank_chunk_ingest_receipts_chunk_tenant_fkey",
    "rank_snapshots_manifest_tenant_fkey",
    "rank_snapshots_chunk_tenant_fkey",
    "rank_snapshots_entry_tenant_fkey",
    "rank_snapshots_keyword_tenant_fkey"
  ]) {
    assert.match(sql, new RegExp(`"${constraint}"`, "u"));
  }
  assert.match(
    sql,
    /"chunk_hash" = NEW\."manifest_chunk_hash"/u
  );
  assert.match(
    sql,
    /"chunk_entry_count" = NEW\."persisted_count"/u
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER\s+"rank_snapshots_ingest_receipt_at_commit"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER\s+"current_ranks_ingest_receipt_at_commit"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u
  );
  for (const trigger of [
    "rank_snapshots_immutable",
    "current_ranks_monotonic",
    "rank_chunk_ingest_receipts_immutable",
    "rank_snapshots_no_truncate",
    "current_ranks_no_truncate",
    "rank_chunk_ingest_receipts_no_truncate"
  ]) {
    assert.match(sql, new RegExp(`"${trigger}"`, "u"));
  }
});

test("rank result migration binds quality flags to missing fields", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /rank_data_quality_flags_valid/u);
  assert.match(
    sql,
    /"rank_snapshots_data_quality_shape"/u
  );
  for (const flag of [
    "ABSOLUTE_POSITION_UNAVAILABLE",
    "PIXEL_POSITION_UNAVAILABLE",
    "TITLE_UNAVAILABLE",
    "SNIPPET_UNAVAILABLE"
  ]) {
    assert.match(
      sql,
      new RegExp(
        `IS NULL\\)[\\s\\S]*"data_quality_flags"[\\s\\S]*${flag}`,
        "u"
      )
    );
  }
  assert.match(
    sql,
    /NOT "found"[\s\S]*<@ '\["PROVIDER_OBSERVED_AT_UNAVAILABLE"\]'::jsonb/u
  );
});

test("completion receipt and outbox require each other at commit", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "rank_completion_outbox_manifest_key"/u
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER\s+"rank_check_finalization_completion_outbox_at_commit"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER\s+"rank_completion_outbox_receipt_at_commit"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u
  );
  assert.match(
    sql,
    /'seo\.rank-check\.completed\.v1'/u
  );
  for (const forbidden of [
    "credentialId",
    "providerRequestId",
    "keywordId",
    "rankingUrl"
  ]) {
    assert.doesNotMatch(sql, new RegExp(`'${forbidden}'`, "u"));
  }
});
