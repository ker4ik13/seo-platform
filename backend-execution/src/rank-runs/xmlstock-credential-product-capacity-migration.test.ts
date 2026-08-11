import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL(
    "../../prisma/migrations/20260811234500_xmlstock_credential_product_capacity/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("removes only the global XMLStock lifecycle cap", async () => {
  const sql = await migration;
  assert.match(
    sql,
    /IF provider_name = 'XMLSTOCK' THEN[\s\S]*claim_rank_connector_execution/u
  );
  assert.match(sql, /IF provider_name <> 'ARSENKIN' THEN RETURN/u);
  assert.match(sql, /active_provider_tasks >= 5/u);
});

test("fairly schedules projects and restores attempts on local capacity waits", async () => {
  const sql = await migration;
  assert.match(sql, /active_execution\."credential_id" = execution\."credential_id"/u);
  assert.match(sql, /active_execution\.project_id = execution\.project_id/u);
  assert.match(sql, /job\.updated_at, job\.created_at/u);
  assert.match(sql, /CREATE FUNCTION public\.defer_rank_connector_poll_capacity/u);
  assert.match(sql, /poll_attempt_count = execution\.poll_attempt_count - 1/u);
  assert.match(
    sql,
    /new_provider CONSTANT TEXT :=\s*\n\s*'AND job\.provider IN \(''ARSENKIN'', ''XMLSTOCK''\)'/u
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.defer_rank_connector_poll_capacity/u
  );
});
