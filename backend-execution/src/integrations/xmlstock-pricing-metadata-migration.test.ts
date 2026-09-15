import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260915093000_xmlstock_account_pricing_metadata/migration.sql",
  import.meta.url
);
const objectCountFixUrl = new URL(
  "../../prisma/migrations/20260915094500_xmlstock_pricing_guard_object_counts/migration.sql",
  import.meta.url
);

test("XMLStock pricing migration keeps URLs out and validates every safe rate", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /xmlStockPricing/u);
  assert.match(sql, /xmlStockStatus/u);
  assert.match(sql, /YANDEX_SEARCH_API/u);
  assert.match(sql, /YANDEX_TURBO/u);
  assert.match(sql, /GOOGLE_LIVE/u);
  assert.match(sql, /WORDSTAT/u);
  assert.match(sql, /jsonb_object_length/u);
  assert.doesNotMatch(sql, /''(?:method|urls)''/u);
  assert.match(sql, /finish_integration_credential_validation_success/u);
});

test("XMLStock pricing guard uses PostgreSQL jsonb object keys for exact counts", async () => {
  const sql = await readFile(objectCountFixUrl, "utf8");
  assert.match(sql, /jsonb_object_keys/u);
  assert.match(sql, /pricesPerThousand/u);
  assert.match(sql, /availableRequests/u);
  assert.match(sql, /loadPercent/u);
  assert.match(sql, /pg_get_functiondef/u);
});
