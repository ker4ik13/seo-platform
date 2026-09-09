import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260908170000_frequency_seasonality_rank_history_deletions/migration.sql",
  import.meta.url
);

test("adds append-only seasonality and rank-history exclusion evidence", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /CREATE TABLE "frequency_seasonality_points"/u);
  assert.match(sql, /CREATE TABLE "rank_dimension_history_deletions"/u);
  assert.match(sql, /"affected_snapshot_count" INTEGER NOT NULL/u);
  assert.match(sql, /frequency_seasonality_points_no_delete/u);
  assert.match(sql, /rank_dimension_history_deletions_no_delete/u);
  assert.match(sql, /'frequency_seasonality_points'/u);
  assert.match(sql, /'rank_dimension_history_deletions'/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
