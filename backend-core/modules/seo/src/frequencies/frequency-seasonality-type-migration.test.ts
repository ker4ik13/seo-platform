import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("seasonality type migration backfills base rows and extends immutable uniqueness", async () => {
  const migration = await readFile(
    new URL("../../prisma/migrations/20260909143000_frequency_seasonality_types/migration.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /ADD COLUMN "type" VARCHAR\(64\) NOT NULL DEFAULT 'BASE'/u);
  assert.match(migration, /"type" IN \('BASE', 'EXACT', 'FIXED'\)/u);
  assert.match(migration, /"job_id", "keyword_id", "type",/u);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE/u);
});
