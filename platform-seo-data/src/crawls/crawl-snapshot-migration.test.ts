import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260731160000_crawl_snapshots_and_issues/migration.sql",
  import.meta.url
);
const changesMigrationUrl = new URL(
  "../../prisma/migrations/20260731200000_crawl_page_changes/migration.sql",
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

test("crawl page changes are tenant-bound, normalized and immutable", async () => {
  const sql = await readFile(changesMigrationUrl, "utf8");
  assert.match(
    sql,
    /crawl_page_changes_previous_snapshot_tenant_fkey[\s\S]*FOREIGN KEY \("workspace_id", "project_id", "previous_snapshot_id"\)/u
  );
  assert.match(
    sql,
    /crawl_page_changes_current_snapshot_tenant_fkey[\s\S]*FOREIGN KEY \("workspace_id", "project_id", "current_snapshot_id"\)/u
  );
  assert.match(sql, /crawl_page_changes_hash_check/u);
  assert.match(sql, /crawl_page_changes_diff_check/u);
  assert.match(sql, /crawl_page_changes_immutable_trigger/u);
  assert.match(sql, /redirect_chain/u);
  assert.doesNotMatch(sql, /raw_html/iu);
});
