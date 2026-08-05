import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260729130000_versioned_tracking_contexts/migration.sql",
  import.meta.url
);

test("migration serializes concurrent legacy writers before fail-closed checks", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const lock = sql.indexOf("LOCK TABLE");
  const exclusive = sql.indexOf("IN ACCESS EXCLUSIVE MODE");
  const precondition = sql.indexOf("IF EXISTS");
  const destructiveStep = sql.indexOf('DROP TABLE "tracking_contexts"');

  assert.match(sql, /^BEGIN;/u);
  assert.ok(lock > 0);
  assert.ok(exclusive > lock);
  assert.ok(precondition > exclusive);
  assert.ok(destructiveStep > precondition);
  assert.match(sql, /EXISTS \(SELECT 1 FROM "tracking_contexts"\)/u);
  assert.match(sql, /EXISTS \(SELECT 1 FROM "rank_snapshots"\)/u);
  assert.match(sql, /EXISTS \(SELECT 1 FROM "current_ranks"\)/u);
  assert.match(sql, /COMMIT;\s*$/u);
});

test("migration enforces tenant-safe and temporal assignment constraints", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /tracking_context_assignments_active_key[\s\S]*WHERE "removed_at" IS NULL/u
  );
  assert.match(
    sql,
    /FOREIGN KEY \("workspace_id", "project_id", "context_id"\)[\s\S]*REFERENCES "tracking_contexts" \("workspace_id", "project_id", "id"\)/u
  );
  assert.match(
    sql,
    /FOREIGN KEY \("workspace_id", "project_id", "keyword_id"\)[\s\S]*REFERENCES "keywords" \("workspace_id", "project_id", "id"\)/u
  );
  assert.match(
    sql,
    /tracking_context_versions_region_label_requires_code[\s\S]*"region_label" IS NULL[\s\S]*OR "region_code" IS NOT NULL/u
  );
  assert.match(
    sql,
    /tracking_context_create_receipts_key_valid[\s\S]*\^\[A-Za-z0-9\._:-\]\{8,180\}\$/u
  );
  assert.doesNotMatch(
    sql,
    /(?:ALTER|CREATE|DROP) TABLE "(?:rank_snapshots|current_ranks)"/u
  );
});
