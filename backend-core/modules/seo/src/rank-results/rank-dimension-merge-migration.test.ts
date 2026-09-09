import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260909123000_rank_dimension_merges/migration.sql",
  import.meta.url
);

test("adds scoped reversible rank-dimension merge preferences", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /CREATE TABLE "rank_dimension_merges"/u);
  assert.match(sql, /source_dimension_key/u);
  assert.match(sql, /target_dimension_key/u);
  assert.match(sql, /rank_dimension_merges_source_key/u);
  assert.match(sql, /rank_dimension_merges_target_idx/u);
  assert.match(sql, /transfer_seo_project_workspace/u);
  assert.match(sql, /'rank_dimension_merges'/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
