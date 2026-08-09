import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("adds immutable Top-10 SERP evidence without rewriting rank history", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260809153000_rank_serp_results/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(migration, /CREATE TABLE "rank_serp_results"/u);
  assert.match(
    migration,
    /FOREIGN KEY \("snapshot_observed_at", "snapshot_id"\)[\s\S]*REFERENCES "rank_snapshots"\("observed_at", "id"\)/u
  );
  assert.match(migration, /CHECK \("position" BETWEEN 1 AND 10\)/u);
  assert.match(migration, /rank_serp_results_immutable/u);
  assert.doesNotMatch(
    migration,
    /\b(?:UPDATE\s+"|DELETE FROM|TRUNCATE|DROP TABLE)\b/u
  );
});
