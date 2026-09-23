import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank polling checks indexed due work before the full broker graph", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260923073000_rank_poll_idle_fast_path/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /rank_connector_executions_connector_poll_due_idx/u);
  assert.match(
    sql,
    /execution\.execution_connector_version =\s*p_execution_connector_version/u
  );
  assert.match(sql, /JOIN public\.jobs job/u);
  assert.match(sql, /job\.status = 'RUNNING'/u);
  assert.match(sql, /execution\.next_action_at <= clock_timestamp\(\)/u);
  assert.match(sql, /execution\.lease_expires_at <= clock_timestamp\(\)/u);
  assert.match(sql, /claim_rank_connector_poll\(text,integer,text\)/u);
  assert.doesNotMatch(sql, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/u);
});
