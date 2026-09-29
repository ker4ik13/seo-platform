import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../prisma/migrations/20260929193000_rank_poll_fairness_aggregate/migration.sql", import.meta.url),
  "utf8"
);

test("poll fairness aggregates live leases once instead of counting per candidate", () => {
  assert.match(migration, /WITH active_fetches AS MATERIALIZED/u);
  assert.match(migration, /active_execution\.status = 'FETCHING'/u);
  assert.match(migration, /LEFT JOIN active_fetches/u);
  assert.match(migration, /COALESCE\(active_fetches\.active_count, 0\)/u);
  assert.match(migration, /rank poll claim before fairness aggregation/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_rank_connector_poll/u);
});
