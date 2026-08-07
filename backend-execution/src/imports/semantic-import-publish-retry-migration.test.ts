import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260807130000_semantic_import_publish_retry_limit/migration.sql",
  import.meta.url
);

test("semantic import publish retries are persisted and bounded", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /ADD COLUMN "publishing_attempts" INTEGER NOT NULL DEFAULT 0/u);
  assert.match(sql, /CHECK \("publishing_attempts" >= 0\)/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
