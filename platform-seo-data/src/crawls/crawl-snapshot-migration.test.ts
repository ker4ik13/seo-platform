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
const sitemapMigrationUrl = new URL(
  "../../prisma/migrations/20260731213000_crawl_sitemap_scope/migration.sql",
  import.meta.url
);
const conditionalMigrationUrl = new URL(
  "../../prisma/migrations/20260731230000_crawl_conditional_requests/migration.sql",
  import.meta.url
);
const duplicateMigrationUrl = new URL(
  "../../prisma/migrations/20260801010000_crawl_duplicate_groups/migration.sql",
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

test("sitemap presence is immutable evidence and a Radar change field", async () => {
  const sql = await readFile(sitemapMigrationUrl, "utf8");
  assert.match(sql, /ADD COLUMN "in_sitemap" BOOLEAN NOT NULL/u);
  assert.match(sql, /DROP CONSTRAINT "crawl_page_changes_diff_check"/u);
  assert.match(sql, /'inSitemap'/u);
  assert.doesNotMatch(sql, /raw_html/iu);
});

test("conditional snapshot reuse is tenant-bound and validator-safe", async () => {
  const sql = await readFile(conditionalMigrationUrl, "utf8");
  assert.match(sql, /ADD COLUMN "etag" VARCHAR\(1000\)/u);
  assert.match(sql, /ADD COLUMN "last_modified" VARCHAR\(128\)/u);
  assert.match(sql, /crawl_page_snapshots_http_validator_check/u);
  assert.match(sql, /crawl_page_snapshots_reuse_check/u);
  assert.match(
    sql,
    /crawl_page_snapshots_reused_from_tenant_fkey[\s\S]*FOREIGN KEY \("workspace_id", "project_id", "reused_from_snapshot_id"\)/u
  );
  assert.doesNotMatch(sql, /raw_html/iu);
});

test("duplicate analyses are bounded, tenant-bound and immutable", async () => {
  const sql = await readFile(duplicateMigrationUrl, "utf8");
  assert.match(sql, /crawl_duplicate_analyses_counts_check/u);
  assert.match(sql, /crawl_duplicate_groups_member_count_check/u);
  assert.match(
    sql,
    /crawl_duplicate_group_members_group_tenant_fkey[\s\S]*FOREIGN KEY \("workspace_id", "project_id", "crawl_id", "group_id"\)/u
  );
  assert.match(
    sql,
    /crawl_duplicate_group_members_snapshot_tenant_fkey[\s\S]*FOREIGN KEY \("workspace_id", "project_id", "crawl_id", "snapshot_id"\)/u
  );
  assert.match(sql, /crawl_duplicate_groups_immutable_trigger/u);
  assert.match(sql, /crawl_duplicate_group_members_immutable_trigger/u);
  assert.doesNotMatch(sql, /raw_html/iu);
});
