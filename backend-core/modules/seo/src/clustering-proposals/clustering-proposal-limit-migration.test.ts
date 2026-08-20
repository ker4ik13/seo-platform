import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260820143000_arsenkin_clustering_300000/migration.sql",
  import.meta.url
);

test("raises the durable clustering proposal bound to 300,000 keywords", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /keyword_count BETWEEN 1 AND 300000/u);
  assert.match(sql, /ADD CONSTRAINT clustering_proposals_counts_check/u);
  assert.match(sql, /NOT VALID/u);
  assert.match(sql, /VALIDATE CONSTRAINT clustering_proposals_counts_check/u);
});
