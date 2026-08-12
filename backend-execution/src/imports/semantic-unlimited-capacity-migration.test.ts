import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("semantic import snapshots accept zero as an unlimited capacity", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260812140000_semantic_import_unlimited_entitlements/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    sql,
    /"semantic_imports_entitlement_completeness_check"[\s\S]*"stored_keywords_limit" >= 0[\s\S]*"keywords_per_project_limit" >= 0[\s\S]*"folders_per_project_limit" >= 0[\s\S]*"tracked_context_pairs_limit" >= 0/u
  );
  assert.match(
    sql,
    /VALIDATE CONSTRAINT "semantic_imports_entitlement_completeness_check"/u
  );
});
