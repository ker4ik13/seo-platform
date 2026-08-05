import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("publishes immutable collaboration limits for every plan", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260804133000_team_seat_plan_versions/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /SET "effective_to" = '2026-08-04T00:00:00Z'/u);
  assert.match(sql, /000000000001'::uuid, '019fc999[^\n]+, 3\)/u);
  assert.match(sql, /000000000002'::uuid, '019fc999[^\n]+, 10\)/u);
  assert.match(sql, /000000000003'::uuid, '019fc999[^\n]+, 20\)/u);
  assert.equal((sql.match(/, 50\)/gu) ?? []).length, 3);
  assert.match(sql, /"previous"\."features" \|\| jsonb_build_object\('seats'/u);
  assert.match(sql, /INSERT INTO "billing_plan_prices"/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
