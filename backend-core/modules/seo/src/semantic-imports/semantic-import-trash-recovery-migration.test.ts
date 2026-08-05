import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("semantic import receipts persist bounded trash recovery candidates", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260803143000_semantic_import_trash_recovery/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /ADD COLUMN "trashed_duplicate_candidates" JSONB NOT NULL DEFAULT '\[\]'::jsonb/u);
  assert.match(sql, /jsonb_typeof\("trashed_duplicate_candidates"\) = 'array'/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
