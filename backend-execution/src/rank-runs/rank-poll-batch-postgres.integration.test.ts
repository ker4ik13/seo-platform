import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import {
  xmlStockPollBatchSql,
  xmlStockSubmitBatchSql
} from "./rank-connector-runtime-broker.service.js";

const databaseUrl = process.env.JOBS_RANK_TEST_DATABASE_URL;

test("the production submit and poll batch SQL executes on PostgreSQL", {
  skip: databaseUrl === undefined,
  timeout: 15_000
}, async () => {
  assert.ok(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const ids = [randomUUID(), randomUUID()];
  const owner = `remote:${randomUUID()}:${randomUUID()}`;
  try {
    for (const query of [
      xmlStockSubmitBatchSql(ids, owner, 25),
      xmlStockPollBatchSql(ids, owner, 90)
    ]) {
      const result = await client.query(query.text, [...query.values]);
      assert.equal(result.rowCount, 0, "unknown execution IDs must not claim work");
    }
  } finally {
    await client.end();
  }
});
