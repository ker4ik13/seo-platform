import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260801223000_semantic_system_groups/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("adds unique active semantic system groups", () => {
  assert.match(
    migration,
    /CREATE TYPE "KeywordGroupSystemKind" AS ENUM \('UNGROUPED', 'TRASH'\)/u
  );
  assert.match(
    migration,
    /WHERE "system_kind" IS NOT NULL AND "status" = 'ACTIVE'/u
  );
});
