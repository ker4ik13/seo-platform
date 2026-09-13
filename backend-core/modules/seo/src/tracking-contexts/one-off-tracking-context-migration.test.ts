import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one-off contexts are additive, indexed and hide competitor-only history", async () => {
  const foundation = await readFile(
    new URL(
      "../../prisma/migrations/20260913120000_one_off_tracking_contexts/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  const backfill = await readFile(
    new URL(
      "../../prisma/migrations/20260913123000_hide_legacy_competitor_contexts/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    foundation,
    /ADD COLUMN "is_reusable" BOOLEAN NOT NULL DEFAULT true/u
  );
  assert.match(
    foundation,
    /CREATE INDEX "tracking_contexts_reusable_status_created_idx"/u
  );
  assert.match(backfill, /'purpose' = 'COMPETITOR_SERP'/u);
  assert.match(backfill, /NOT EXISTS[\s\S]*'POSITION_TRACKING'[\s\S]*<> 'COMPETITOR_SERP'/u);
  assert.doesNotMatch(backfill, /DELETE FROM/u);
});
