import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260802233000_explicit_rank_provider_routes/migration.sql",
  import.meta.url
);

test("explicit rank provider routes keep a bounded primary-first order", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /DROP CONSTRAINT "project_connector_routes_position_zero"/u
  );
  assert.match(
    migration,
    /CONSTRAINT "project_connector_routes_position_bounded"[\s\S]*BETWEEN 0 AND 7/u
  );
  assert.match(migration, /c\."provider" IN \('ARSENKIN', 'XMLSTOCK'\)/u);
  assert.match(migration, /c\."verified_at" IS NOT NULL/u);
  assert.match(
    migration,
    /c\."capabilities" @> '\["SERP_RANK_TRACKING"\]'::jsonb/u
  );
  assert.match(migration, /candidate\."position" BETWEEN 1 AND 7/u);
});
