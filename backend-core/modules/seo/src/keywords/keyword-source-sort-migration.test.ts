import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260801212000_keyword_source_sort_index/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("adds the tenant-scoped source sort index", () => {
  assert.match(
    migration,
    /ON "keywords" \("workspace_id", "project_id", "status", "source_mode", "id"\)/u
  );
});
