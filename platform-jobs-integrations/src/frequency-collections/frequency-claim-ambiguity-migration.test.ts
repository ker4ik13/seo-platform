import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260801193000_fix_frequency_claim_attempt_ambiguity/migration.sql",
  import.meta.url
);

test("frequency claim increments the locked item without PL/pgSQL ambiguity", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /attempt = item_row\.attempt \+ 1/u);
  assert.doesNotMatch(sql, /attempt = attempt \+ 1/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*claim_frequency_collection_item/u);
});
