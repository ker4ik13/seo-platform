import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("extends tracking depths for bounded competitor SERP collection", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260909170000_competitor_serp_depths/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /^BEGIN;/u);
  assert.match(migration, /DROP CONSTRAINT "tracking_context_versions_depth_allowed"/u);
  assert.match(migration, /CHECK \("depth" IN \(10, 20, 30, 50, 100\)\)/u);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE/u);
  assert.match(migration, /COMMIT;\s*$/u);
});
