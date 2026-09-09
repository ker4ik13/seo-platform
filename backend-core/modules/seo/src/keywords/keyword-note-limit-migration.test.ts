import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260908183000_unbounded_keyword_notes/migration.sql",
  import.meta.url
);

test("removes the legacy keyword-note product limit without rewriting data", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS "keywords_note_length"/u);
  assert.doesNotMatch(sql, /DELETE|TRUNCATE|UPDATE\s+"keywords"/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
