import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("semantic version migration adds tenant-safe reversible change sets", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260730213000_semantic_version_changes/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /"affected_count" INTEGER NOT NULL DEFAULT 0/u);
  assert.match(sql, /"reversible" BOOLEAN NOT NULL DEFAULT FALSE/u);
  assert.match(sql, /"finalized_at" TIMESTAMPTZ/u);
  assert.match(
    sql,
    /FOREIGN KEY \("workspace_id", "project_id", "parent_version_id"\)[\s\S]*REFERENCES "semantic_versions" \("workspace_id", "project_id", "id"\)/u
  );
  assert.match(
    sql,
    /CREATE TABLE "semantic_entity_changes"[\s\S]*"before_state" JSONB[\s\S]*"after_state" JSONB NOT NULL/u
  );
  assert.match(
    sql,
    /"entity_type" IN \('KEYWORD'\)[\s\S]*"operation" IN \('CREATE', 'UPDATE', 'DELETE'\)/u
  );
  assert.match(
    sql,
    /FOREIGN KEY \("workspace_id", "project_id", "semantic_version_id"\)[\s\S]*REFERENCES "semantic_versions" \("workspace_id", "project_id", "id"\)/u
  );
  assert.match(
    sql,
    /CREATE TABLE "semantic_undo_receipts"[\s\S]*PRIMARY KEY \("workspace_id", "project_id", "actor_id", "idempotency_key"\)/u
  );
  assert.match(
    sql,
    /"idempotency_key" ~ '\^\[A-Za-z0-9\._:-\]\{8,180\}\$'/u
  );
  assert.match(
    sql,
    /"semantic_undo_receipts_source_version_fkey"[\s\S]*FOREIGN KEY \("workspace_id", "project_id", "source_version_id"\)[\s\S]*REFERENCES "semantic_versions" \("workspace_id", "project_id", "id"\)/u
  );
  assert.match(sql, /COMMIT;\s*$/u);
});
