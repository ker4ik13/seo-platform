import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("widens immutable normalized SERP evidence to TOP-100", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260818150000_rank_serp_results_top100/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    migration,
    /ALTER TABLE public\.rank_serp_results[\s\S]*CHECK \("position" BETWEEN 1 AND 100\)/u
  );
  assert.doesNotMatch(
    migration,
    /\b(?:UPDATE\s+|DELETE FROM|TRUNCATE|DROP TABLE)\b/u
  );
});
