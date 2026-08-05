import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260729160000_rank_execution_manifests/migration.sql",
  import.meta.url
);

test("manifest migration is transactional and keeps tenant-safe immutable relations", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  assert.match(
    sql,
    /CREATE TYPE "RankExecutionManifestStatus"\s+AS ENUM \('BUILDING', 'SEALED', 'CLOSED'\)/u
  );
  for (const table of [
    "rank_execution_manifests",
    "rank_execution_manifest_chunks",
    "rank_execution_manifest_entries"
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`, "u"));
  }
  for (const sizeConstraint of [
    "request_hash_size",
    "configuration_hash_size",
    "semantic_scope_hash_size",
    "scope_hash_size",
    "manifest_hash_size",
    "deduplication_hash_size",
    "chunks_hash_size",
    "keyword_text_hash_size"
  ]) {
    assert.match(sql, new RegExp(sizeConstraint, "u"));
  }
  assert.match(
    sql,
    /FOREIGN KEY \(\s*"workspace_id",\s*"project_id",\s*"manifest_id",\s*"chunk_index"\s*\)/u
  );
  assert.match(
    sql,
    /FOREIGN KEY \(\s*"workspace_id",\s*"project_id",\s*"assignment_id"\s*\)/u
  );
  assert.match(
    sql,
    /FOREIGN KEY \(\s*"workspace_id",\s*"project_id",\s*"keyword_id"\s*\)/u
  );
  assert.doesNotMatch(sql, /ON DELETE CASCADE/u);
  assert.doesNotMatch(sql, /ON UPDATE CASCADE/u);
  assert.match(
    sql,
    /CREATE TRIGGER "rank_execution_manifests_immutable"[\s\S]*BEFORE INSERT OR UPDATE OR DELETE/u
  );
  assert.match(sql, /TG_OP = 'INSERT'[\s\S]*NEW\."status" = 'BUILDING'/u);
  assert.match(
    sql,
    /OLD\."status" = 'BUILDING'[\s\S]*NEW\."status" = 'SEALED'/u
  );
  assert.match(
    sql,
    /OLD\."status" = 'SEALED'[\s\S]*NEW\."status" = 'CLOSED'/u
  );
  assert.match(
    sql,
    /"manifest_status" = 'BUILDING'/u
  );
  assert.match(
    sql,
    /CREATE CONSTRAINT TRIGGER "rank_execution_manifests_sealed_at_commit"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "rank_execution_manifests_active_dedup_key"[\s\S]*WHERE "status" = 'SEALED'/u
  );
  assert.match(
    sql,
    /"assignment"\."context_id" <> NEW\."tracking_context_id"/u
  );
  assert.match(
    sql,
    /"assignment"\."keyword_id" <> "entry"\."keyword_id"/u
  );
  assert.match(sql, /"assignment"\."removed_at" IS NOT NULL/u);
  for (const trigger of [
    "rank_execution_manifest_chunks_immutable",
    "rank_execution_manifest_entries_immutable",
    "rank_execution_manifests_no_truncate",
    "rank_execution_manifest_chunks_no_truncate",
    "rank_execution_manifest_entries_no_truncate"
  ]) {
    assert.match(sql, new RegExp(`CREATE TRIGGER "${trigger}"`, "u"));
  }
});

test("manifest migration enforces bounded chunks and exact first-slice policy", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /"provider" = 'ARSENKIN' AND "operation" = 'POSITIONS'/u
  );
  assert.match(sql, /"project_status" = 'ACTIVE'/u);
  assert.match(sql, /"pair_count" BETWEEN 1 AND 1000/u);
  assert.match(sql, /"chunk_size" = 250/u);
  assert.match(sql, /"entry_count" BETWEEN 1 AND 250/u);
  assert.match(
    sql,
    /char_length\("keyword_text"\) BETWEEN 1 AND 500/u
  );
  assert.match(
    sql,
    /octet_length\("keyword_text"\) BETWEEN 1 AND 2000/u
  );
  assert.match(
    sql,
    /"chunk_index" = \("sequence" \/ 250\)/u
  );
  assert.match(sql, /'rawSerp',\s*'NOT_COLLECTED'/u);
});
