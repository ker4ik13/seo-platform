import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.JOBS_RANK_TEST_DATABASE_URL;
test("delegated Job has one owner, shares its slots, and fails over on disable/offline", { skip: !databaseUrl, timeout: 15000 }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const jobId = randomUUID();
    await client.query(`INSERT INTO jobs(id, workspace_id, project_id, actor_id, type, status, stage, idempotency_scope, idempotency_key, request_hash, deduplication_key, input_snapshot, scope_snapshot, progress_total, progress_unit, estimated_cost_micro, currency, credential_mode, provider, correlation_id, updated_at)
      VALUES($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'MANUAL_RANK_CHECK', 'PREPARING', 'PREPARING_SCOPE', $1::text, $1::text, $5::bytea, $1::text, '{}'::jsonb, '{}'::jsonb, 1, 'KEYWORD', 0, 'RUB', 'BYOK_API_KEY', 'XMLSTOCK', 'owner-test', clock_timestamp())`, [jobId, randomUUID(), randomUUID(), randomUUID(), randomBytes(32)]);
    await client.query("UPDATE jobs SET status = 'QUEUED', stage = 'WAITING_FOR_QUEUE', queued_at = clock_timestamp(), version = version + 1 WHERE id = $1", [jobId]);
    await client.query("UPDATE jobs SET status = 'RUNNING', stage = 'WAITING_EXECUTION_GRANT', started_at = clock_timestamp(), version = version + 1 WHERE id = $1", [jobId]);
    const nodeIds: string[] = [randomUUID(), randomUUID()];
    for (const nodeId of nodeIds) await client.query(`INSERT INTO execution_worker_nodes(id, name, token_hash, enabled, capabilities, max_http_slots, reported_http_slots, reported_rank_slots, last_heartbeat_at, last_protocol_version)
      VALUES($1, 'owner-test', $2, true, ARRAY['RANK'], 16, 16, 4, clock_timestamp(), 1)`, [nodeId, randomBytes(32)]);
    const owner = async () => (await client.query<{ owner: string | null }>("SELECT public.rank_job_poll_owner($1) AS owner", [jobId])).rows[0]!.owner;
    const first = await owner();
    assert.ok(first && nodeIds.includes(first));
    assert.equal(await owner(), first);
    const view = await client.query<{ nodeId: string; activeTasks: string }>("SELECT * FROM public.list_remote_worker_rank_assignments(1000) WHERE \"jobId\" = $1", [jobId]);
    assert.equal(view.rows[0]?.nodeId, first);
    assert.equal(Number(view.rows[0]?.activeTasks), 0, "stable assignment remains visible between GET requests");
    const matches = async (lease: string) => (await client.query<{ matches: boolean }>("SELECT public.rank_poll_owner_matches($1, $2) AS matches", [jobId, lease])).rows[0]!.matches;
    assert.equal(await matches("main-worker"), false);
    assert.equal(await matches(`remote:${first}:${randomUUID()}`), true);
    await client.query("UPDATE execution_worker_nodes SET active_work_items = 16 WHERE id = $1", [first]);
    assert.equal(await owner(), first, "busy node stays owner; main must not steal pages");
    await client.query("UPDATE execution_worker_nodes SET enabled = false WHERE id = $1", [first]);
    const second = await owner();
    assert.ok(second && second !== first);
    assert.equal(await matches(`remote:${first}:${randomUUID()}`), false);
    await client.query("UPDATE execution_worker_nodes SET last_heartbeat_at = clock_timestamp() - interval '1 minute' WHERE id = $1", [second]);
    assert.equal(await owner(), null);
    assert.equal(await matches("main-worker"), true);
    const generation = await client.query<{ generation: number }>("SELECT generation FROM rank_job_worker_assignments WHERE job_id = $1", [jobId]);
    assert.equal(generation.rows[0]!.generation, 2);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
