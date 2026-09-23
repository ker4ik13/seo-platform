import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260923010000_frequency_fallback_route_execution/migration.sql",
    import.meta.url
  ),
  "utf8"
).replace(/\s+/gu, " ");

test("frequency runtime accepts the exact selected fallback route", () => {
  assert.match(
    migration,
    /claim_frequency_collection_item\(text,integer\)/u
  );
  assert.match(migration, /route\.position = 0/u);
  assert.match(migration, /EXECUTE replace\(definition, route_position, ''\)/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.claim_frequency_collection_item/u
  );
});
