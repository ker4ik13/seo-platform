import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("semantic import snapshot persists the immutable project folder limit", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260804151000_semantic_import_folder_capacity/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /"folders_per_project_limit" BIGINT/u);
  assert.match(
    sql,
    /"semantic_imports_entitlement_completeness_check"[\s\S]*"folders_per_project_limit" >= 0/u
  );
});
