import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260801060000_cluster_reclustering_controls/migration.sql",
  import.meta.url
);

test("cluster reclustering controls migration is online and indexed", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /"is_locked" BOOLEAN NOT NULL DEFAULT false/u);
  assert.match(sql, /"exclude_from_reclustering" BOOLEAN NOT NULL DEFAULT false/u);
  assert.match(sql, /CREATE INDEX CONCURRENTLY "clusters_reclustering_eligibility_idx"/u);
});
