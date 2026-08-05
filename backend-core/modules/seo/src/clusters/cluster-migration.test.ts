import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260801030000_semantic_cluster_integrity/migration.sql",
  import.meta.url
);

test("cluster integrity migration is tenant-safe and fail-closed", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /Cannot add tenant-safe keyword cluster FK/u);
  assert.match(
    sql,
    /FOREIGN KEY \("workspace_id", "project_id", "cluster_id"\)[\s\S]*REFERENCES "clusters" \("workspace_id", "project_id", "id"\)/u
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "clusters_active_name_key"[\s\S]*lower\("name"\)[\s\S]*WHERE "status" = 'ACTIVE'/u
  );
  assert.match(sql, /clusters_name_not_blank/u);
  assert.match(sql, /clusters_version_positive/u);
});
