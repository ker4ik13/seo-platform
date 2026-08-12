import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../../prisma/migrations/20260812153000_semantic_import_unlimited_receipts/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("semantic import receipt migration accepts unlimited entitlement snapshots", () => {
  assert.match(
    migration,
    /semantic_import_receipts_stored_keywords_limit_check[\s\S]*stored_keywords_limit"\s*>=\s*0/u
  );
  assert.match(
    migration,
    /semantic_import_receipts_keywords_per_project_limit_check[\s\S]*keywords_per_project_limit"\s*>=\s*0/u
  );
  assert.doesNotMatch(migration, /DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/iu);
});
