import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("adds an opt-in position projection policy to competitor snapshots", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260902163000_competitor_position_tracking_policy/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    sql,
    /ALTER TABLE "rank_snapshots"[\s\S]*ADD COLUMN "position_tracking_enabled" BOOLEAN NOT NULL DEFAULT TRUE/u
  );
  assert.match(
    sql,
    /ALTER TABLE "ai_answer_snapshots"[\s\S]*ADD COLUMN "position_tracking_enabled" BOOLEAN NOT NULL DEFAULT TRUE/u
  );
  assert.doesNotMatch(
    sql,
    /\b(?:UPDATE\s+"|DELETE FROM|TRUNCATE|DROP TABLE)\b/u
  );
});
