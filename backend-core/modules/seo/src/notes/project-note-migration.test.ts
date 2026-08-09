import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("adds project notes without rewriting existing project data", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260809190000_project_notes/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(migration, /CREATE TABLE "project_notes"/u);
  assert.match(migration, /"public_token" VARCHAR\(64\)/u);
  assert.match(migration, /UNIQUE INDEX "project_notes_public_token_key"/u);
  assert.doesNotMatch(
    migration,
    /\b(?:UPDATE\s+"|DELETE FROM|TRUNCATE|DROP TABLE)\b/u
  );
});
