import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";

const migration = new URL(
  "../../prisma/migrations/20261005065000_rank_targeted_submit_separate_job_lock/migration.sql",
  import.meta.url
);

test("the first migration separates the exact Job lock from the graph hint", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /WITH target_execution AS MATERIALIZED/u);
  assert.match(sql, /old_claim\) <> 1/u);
  assert.match(sql, /rank-connector-claim:job-lock/u);
  assert.match(sql, /job\."workspace_id" = candidate\."workspace_id"/u);
  assert.match(sql, /job\."version" = candidate\."job_version"/u);
  assert.match(sql, /FOR UPDATE OF job SKIP LOCKED/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION/u);
});

test("PostgreSQL uses an indexed execution hint and a separate parent lock", {
  skip: process.env.JOBS_RANK_TEST_DATABASE_URL === undefined
}, async () => {
  const client = new Client({ connectionString: process.env.JOBS_RANK_TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ definition: string }>(`
      SELECT pg_get_functiondef(
        'public.claim_rank_connector_execution_pre_authorization_targeted(text,integer,text,uuid)'::regprocedure
      ) AS definition
    `);
    const definition = rows[0]?.definition;
    assert.ok(definition);
    const graph = definition.indexOf("rank-connector-claim:job");
    const lock = definition.indexOf("rank-connector-claim:job-lock");
    const child = definition.indexOf("rank-connector-claim:run");
    assert.ok(graph >= 0 && lock > graph && child > lock);
    assert.match(definition.slice(graph, lock), /FROM public\.rank_connector_executions execution/u);
    assert.match(definition.slice(graph, lock), /execution\."id" = p_execution_id/u);
    assert.doesNotMatch(definition.slice(graph, lock), /JOIN public\./u);
    assert.doesNotMatch(definition.slice(graph, lock), /FOR UPDATE OF job/u);
    assert.match(definition.slice(lock, child), /FOR UPDATE OF job SKIP LOCKED/u);
    assert.match(definition.slice(child), /rank-connector-claim:execution/u);
  } finally {
    await client.end();
  }
});
