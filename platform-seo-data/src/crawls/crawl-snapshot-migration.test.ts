import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260731160000_crawl_snapshots_and_issues/migration.sql",
  import.meta.url
);

test("crawl evidence is tenant-bound, bounded and immutable", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /crawl_page_snapshots_page_tenant_fkey[\s\S]*FOREIGN KEY \("workspace_id", "project_id", "page_id"\)/u
  );
  assert.match(sql, /crawl_page_snapshots_bounds_check/u);
  assert.match(sql, /crawl_page_snapshots_hash_check/u);
  assert.match(sql, /crawl_page_snapshots_immutable_trigger/u);
  assert.match(sql, /crawl_issue_occurrences_immutable_trigger/u);
  assert.doesNotMatch(sql, /raw_html/iu);
});
