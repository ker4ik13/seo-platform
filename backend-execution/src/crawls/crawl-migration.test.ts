import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260731150000_technical_crawls/migration.sql",
  import.meta.url
);
const sitemapScopeMigrationUrl = new URL(
  "../../prisma/migrations/20260731213500_crawl_sitemap_scope/migration.sql",
  import.meta.url
);

test("technical crawl migration binds the tenant Job and one active host", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /technical_crawls_job_tenant_fkey[\s\S]*FOREIGN KEY \("workspace_id", "project_id", "job_id"\)[\s\S]*REFERENCES "jobs"\("workspace_id", "project_id", "id"\)/u
  );
  assert.match(sql, /technical_crawls_one_active_host_key/u);
  assert.match(sql, /technical_crawls_checkpoint_check/u);
  assert.match(sql, /jsonb_array_length\("checkpoint"->'seen'\) <= 1000/u);
  assert.match(
    sql,
    /WHERE "status" IN \('QUEUED', 'RUNNING', 'CANCEL_REQUESTED'\)/u
  );
  assert.match(sql, /technical_crawls_counts_check/u);
});

test("crawl sitemap scope keeps legacy checkpoints and bounds version 2", async () => {
  const sql = await readFile(sitemapScopeMigrationUrl, "utf8");
  assert.match(
    sql,
    /DROP CONSTRAINT "technical_crawls_checkpoint_check"/u
  );
  assert.match(sql, /"checkpoint"->>'version' IN \('1', '2'\)/u);
  assert.match(
    sql,
    /jsonb_typeof\("checkpoint"->'sitemapPending'\) = 'array'/u
  );
  assert.match(
    sql,
    /jsonb_array_length\("checkpoint"->'sitemapSeen'\) <= 20/u
  );
  assert.match(
    sql,
    /jsonb_typeof\("checkpoint"->'scopeReady'\) = 'boolean'/u
  );
  assert.match(sql, /\) IS TRUE[\s\n]*\)[\s\n]*\);/u);
});
