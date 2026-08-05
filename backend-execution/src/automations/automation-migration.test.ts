import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260731110000_rank_tracking_automations/migration.sql",
  import.meta.url
);

const migration = readFile(MIGRATION, "utf8");

function compactSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

test("creates rank automation state in one transaction", async () => {
  const sql = await migration;

  assert.match(sql, /^BEGIN;\s/u);
  assert.match(sql, /\sCOMMIT;\s*$/u);
  assert.match(sql, /CREATE TYPE "AutomationRunStatus"/u);
  assert.match(sql, /CREATE TABLE "automation_runs"/u);
});

test("binds every automation run to the exact tenant graph", async () => {
  const sql = compactSql(await migration);

  for (const constraint of [
    `"automation_runs_automation_tenant_fkey" FOREIGN KEY ("automation_id", "workspace_id", "project_id") REFERENCES "automations"("id", "workspace_id", "project_id")`,
    `"automation_runs_estimate_tenant_fkey" FOREIGN KEY ("workspace_id", "project_id", "estimate_id") REFERENCES "rank_estimates"("workspace_id", "project_id", "id")`,
    `"automation_runs_job_tenant_fkey" FOREIGN KEY ("workspace_id", "project_id", "job_id") REFERENCES "jobs"("workspace_id", "project_id", "id")`
  ]) {
    assert.ok(sql.includes(constraint), constraint);
  }
});

test("enforces provenance, lifecycle, idempotency and chronology", async () => {
  const sql = await migration;

  assert.match(sql, /CONSTRAINT "automations_provenance_check"/u);
  assert.match(sql, /CONSTRAINT "automations_lifecycle_check"/u);
  assert.match(sql, /CONSTRAINT "automation_runs_lifecycle_check"/u);
  assert.match(sql, /CONSTRAINT "automation_runs_values_check"/u);
  assert.match(sql, /CONSTRAINT "automation_runs_trigger_idempotency_check"/u);
  assert.match(
    sql,
    /"finished_at" >= COALESCE\("started_at", "created_at"\)/u
  );
});
