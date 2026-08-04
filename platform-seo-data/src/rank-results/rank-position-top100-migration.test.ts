import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("widens persisted and current rank positions to provider-supported TOP-100", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260802130000_rank_position_top100/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    migration,
    /ALTER TABLE public\.rank_snapshots[\s\S]*"position" BETWEEN 1 AND 100/u
  );
  assert.match(
    migration,
    /ALTER TABLE public\.current_ranks[\s\S]*"position" BETWEEN 1 AND 100/u
  );
  assert.doesNotMatch(migration, /BETWEEN 1 AND 30/u);
});
