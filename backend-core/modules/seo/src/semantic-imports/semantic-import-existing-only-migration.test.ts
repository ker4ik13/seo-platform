import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("update-only imports keep existing receipts create-enabled", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260807090000_semantic_import_existing_only/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    sql,
    /ADD COLUMN "create_missing_keywords" BOOLEAN NOT NULL DEFAULT TRUE/u
  );
  assert.doesNotMatch(sql, /\b(?:DELETE|DROP|TRUNCATE)\b/iu);
});
