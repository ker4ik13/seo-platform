import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("publishes the workspace subscription catalog with all launch limits", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260804150000_workspace_subscription_catalog_v3/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /WHEN 'TRIAL' THEN 'Бесплатный'/u);
  assert.match(sql, /WHEN 'SOLO' THEN 'Старт'/u);
  assert.match(sql, /WHEN 'TEAM' THEN 'Профессиональный'/u);
  assert.match(sql, /WHEN 'AGENCY' THEN 'Максимальный'/u);
  assert.match(sql, /"seats":3,"projects":1[\s\S]*"foldersPerProject":50,"concurrentJobs":1/u);
  assert.match(sql, /"seats":10,"projects":3[\s\S]*"foldersPerProject":200,"concurrentJobs":5/u);
  assert.match(sql, /"seats":20,"projects":10[\s\S]*"foldersPerProject":500,"concurrentJobs":10/u);
  assert.match(sql, /"seats":50,"projects":30[\s\S]*"foldersPerProject":0,"concurrentJobs":30/u);
  assert.match(sql, /'MONTHLY', 'RUB', 199000/u);
  assert.match(sql, /'MONTHLY', 'RUB', 599000/u);
  assert.match(sql, /'MONTHLY', 'RUB', 1499000/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
