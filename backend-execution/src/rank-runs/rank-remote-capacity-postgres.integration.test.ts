import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import { XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION } from "./rank-execution-evidence.js";

const databaseUrl = process.env.JOBS_RANK_TEST_DATABASE_URL;

test("rank worker reads only bounded healthy remote capacity, not node secrets", {
  skip: databaseUrl === undefined,
  timeout: 15_000
}, async () => {
  assert.ok(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let id: string | undefined;
  try {
    const before = await slots(client, 256);
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO execution_worker_nodes (
        name, token_hash, enabled, capabilities,
        max_http_slots, reported_http_slots, reported_rank_slots,
        uses_env_capacity,
        max_cpu_slots, reported_cpu_slots,
        last_heartbeat_at, last_protocol_version
      ) VALUES (
        'rank-capacity-test', $1::bytea, true, ARRAY['RANK']::text[],
        16, 12, 8, true, 2, 2, clock_timestamp(), 1
      ) RETURNING id::text
    `, [randomBytes(32)]);
    id = inserted.rows[0]?.id;
    assert.ok(id);
    assert.equal(await slots(client, 256), before + 8);
    await client.query("UPDATE execution_worker_nodes SET draining = true WHERE id = $1::uuid", [id]);
    assert.equal(await slots(client, 256), before);
  } finally {
    if (id) await client.query("DELETE FROM execution_worker_nodes WHERE id = $1::uuid", [id]);
    await client.end();
  }
});

async function slots(client: Client, maximum: number): Promise<number> {
  const result = await client.query<{ slots: number }>(
    "SELECT public.available_remote_rank_slots($1::integer) AS slots",
    [maximum]
  );
  return result.rows[0]?.slots ?? -1;
}

test("one SQL statement applies individual XMLStock fences to a rank batch", {
  skip: databaseUrl === undefined,
  timeout: 15_000
}, async () => {
  assert.ok(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const ids = [randomUUID(), randomUUID()];
    const owner = `remote:${randomUUID()}:${randomUUID()}`;
    const poll = await client.query(`
      SELECT claim.* FROM unnest(ARRAY[$1::uuid, $2::uuid]) AS candidate("executionId")
      CROSS JOIN LATERAL public.claim_rank_connector_poll_targeted(
        $3::text, 90::integer, $4::text, candidate."executionId"
      ) claim
    `, [...ids, owner, XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION]);
    assert.equal(poll.rowCount, 0, "nonexistent IDs cannot escape the fenced claim");
    const submit = await client.query(`
      SELECT claim.* FROM unnest(ARRAY[$1::uuid, $2::uuid]) AS candidate("executionId")
      CROSS JOIN LATERAL public.claim_rank_connector_submit_targeted(
        $3::text, 25::integer, $4::text, candidate."executionId"
      ) claim
    `, [...ids, owner, XMLSTOCK_RANK_EXECUTION_CONNECTOR_VERSION]);
    assert.equal(submit.rowCount, 0);
  } finally {
    await client.end();
  }
});
