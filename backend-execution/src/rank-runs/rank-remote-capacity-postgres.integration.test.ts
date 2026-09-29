import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

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
        max_cpu_slots, reported_cpu_slots,
        last_heartbeat_at, last_protocol_version
      ) VALUES (
        'rank-capacity-test', $1::bytea, true, ARRAY['RANK']::text[],
        16, 12, 8, 2, 2, clock_timestamp(), 1
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
