import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("semantic capacity migration stores bounded reservations and abort state", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260731070000_semantic_capacity_entitlements/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    sql,
    /ALTER TYPE "SemanticImportReceiptStatus" ADD VALUE IF NOT EXISTS 'ABORTED'/u
  );
  assert.match(sql, /"stored_keywords_limit" BIGINT NOT NULL/u);
  assert.match(sql, /"keywords_per_project_limit" BIGINT NOT NULL/u);
  assert.match(sql, /"reserved_keywords" BIGINT NOT NULL/u);
  assert.match(
    sql,
    /"semantic_import_receipts_reserved_keywords_check"[\s\S]*CHECK \("reserved_keywords" >= 0\)/u
  );
});
