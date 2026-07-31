import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260731150000_technical_crawls/migration.sql",
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
