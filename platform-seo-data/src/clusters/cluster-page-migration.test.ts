import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260801040000_cluster_primary_page/migration.sql",
  import.meta.url
);

test("cluster primary-page migration is tenant-safe and constrained", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /FOREIGN KEY \("workspace_id", "project_id", "primary_page_id"\)[\s\S]*REFERENCES "pages" \("workspace_id", "project_id", "id"\)/u
  );
  assert.match(sql, /clusters_page_mapping_source_check/u);
  assert.match(sql, /clusters_page_mapping_confidence_check/u);
  assert.match(sql, /clusters_page_mapping_consistency_check/u);
  assert.match(sql, /clusters_primary_page_idx/u);
});
