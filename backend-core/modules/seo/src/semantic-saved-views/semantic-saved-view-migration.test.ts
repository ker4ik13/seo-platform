import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260730170000_semantic_saved_views/migration.sql",
  import.meta.url
);

test("saved-view migration enforces scope-aware active name uniqueness", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /semantic_saved_views_private_name_key[\s\S]*"owner_id"[\s\S]*WHERE "status" = 'ACTIVE' AND "scope" = 'PRIVATE'/u
  );
  assert.match(
    sql,
    /semantic_saved_views_shared_name_key[\s\S]*WHERE "status" = 'ACTIVE' AND "scope" = 'PROJECT_SHARED'/u
  );
  assert.match(
    sql,
    /semantic_saved_views_delete_consistent[\s\S]*"status" = 'ACTIVE' AND "deleted_at" IS NULL[\s\S]*"status" = 'DELETED' AND "deleted_at" IS NOT NULL/u
  );
  assert.match(
    sql,
    /semantic_saved_views_config_object[\s\S]*jsonb_typeof\("config"\) = 'object'/u
  );
});
