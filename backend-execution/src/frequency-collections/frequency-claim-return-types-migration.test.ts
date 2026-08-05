import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260801194000_fix_frequency_claim_return_types/migration.sql",
  import.meta.url
);

test("frequency claim casts bounded varchar columns to its public text contract", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /credential_row\.provider::TEXT/u);
  assert.match(sql, /item_row\.provider_request_id::TEXT/u);
  assert.match(sql, /unexpected frequency claim projection/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*claim_frequency_collection_item/u);
});
