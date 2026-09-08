import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL("../../prisma/migrations/20260908100000_manual_position_history_import/migration.sql", import.meta.url);

test("manual position history expands immutable rank constraints without deleting data", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  for (const value of ["MANUAL_IMPORT", "IMPORTED_MANUAL_HISTORY", "source_mode\" = 'IMPORT'", "VALIDATE CONSTRAINT"]) assert.match(sql, new RegExp(value, "u"));
  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE|DROP TABLE|DROP COLUMN)\b/iu);
});
