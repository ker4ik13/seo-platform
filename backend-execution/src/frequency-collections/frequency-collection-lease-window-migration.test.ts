import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260802150000_frequency_collection_lease_window/migration.sql",
  import.meta.url
);

test("frequency connector lease covers the production SEO Data timeout", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /claim_frequency_collection_item\(text,integer\)/u);
  assert.match(sql, /claim_frequency_collection_batch\(text,integer,integer\)/u);
  assert.match(sql, /mark_frequency_collection_batch_submitting/u);
  assert.match(sql, /renew_frequency_collection_batch_lease/u);
  assert.match(sql, /'BETWEEN 5 AND 60',[\s\S]*'BETWEEN 5 AND 120'/u);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
});
