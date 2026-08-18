import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("adds an optional safe provider favicon URL to immutable SERP evidence", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260818173000_rank_serp_result_favicons/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    migration,
    /ADD COLUMN "favicon_url" TEXT[\s\S]*length\("favicon_url"\) BETWEEN 1 AND 4096[\s\S]*"favicon_url" ~ '\^https\?:\/\/'/u
  );
  assert.doesNotMatch(
    migration,
    /\b(?:UPDATE\s+|DELETE FROM|TRUNCATE|DROP TABLE)\b/u
  );
});
