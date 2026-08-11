import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("publishes v4 capacities and upgrades subscriptions without deleting data", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260811223000_workspace_subscription_catalog_v4/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /"seats":5,"projects":2,"storedKeywords":10000,"keywordsPerProject":5000,"foldersPerProject":0,"concurrentJobs":1/u);
  assert.match(sql, /"seats":20,"projects":10,"storedKeywords":200000,"keywordsPerProject":20000,"foldersPerProject":0,"concurrentJobs":5/u);
  assert.match(sql, /"seats":50,"projects":30,"storedKeywords":1500000,"keywordsPerProject":50000,"foldersPerProject":0,"concurrentJobs":15/u);
  assert.match(sql, /"seats":100,"projects":100,"storedKeywords":0,"keywordsPerProject":0,"foldersPerProject":0,"concurrentJobs":30/u);
  assert.match(sql, /UPDATE "billing_subscriptions" AS subscription/u);
  assert.match(sql, /subscription\."status"::text <> 'CANCELLED'/u);
  assert.doesNotMatch(sql, /DELETE\s+FROM/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
