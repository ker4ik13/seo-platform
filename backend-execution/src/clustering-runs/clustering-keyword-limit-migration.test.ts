import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260820144000_arsenkin_clustering_300000/migration.sql",
  import.meta.url
);

test("raises every fenced clustering broker command to 300,000 items", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  for (const routine of [
    "claim_clustering_run",
    "renew_clustering_run_lease",
    "mark_clustering_run_submitting",
    "transition_clustering_run"
  ]) {
    assert.match(sql, new RegExp(`public\\.${routine}\\(`, "u"));
  }
  assert.match(sql, /pg_get_functiondef/u);
  assert.match(sql, /expected_count NOT BETWEEN 1 AND 300000/u);
  assert.match(sql, /Unexpected clustering bound/u);
});
