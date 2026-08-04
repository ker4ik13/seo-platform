import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260801223500_kc4_group_manifest/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("stores the bounded KC4 group manifest outside keyword rows", () => {
  assert.match(
    migration,
    /ADD COLUMN "source_metadata" JSONB/u
  );
});
