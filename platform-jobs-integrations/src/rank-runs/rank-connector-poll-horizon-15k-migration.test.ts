import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260802144000_rank_connector_poll_horizon_15k/migration.sql",
  import.meta.url
);

test("widens only the rank polling lifecycle horizon for 15k tasks", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /replace\(shape_definition, '180', '720'\)/u);
  assert.match(
    sql,
    /assert_rank_connector_execution_claim_transition\(\)/u
  );
  assert.match(
    sql,
    /claim_rank_connector_poll\(text,integer,text\)/u
  );
  assert.match(
    sql,
    /complete_rank_connector_poll\(uuid,uuid,text,uuid,integer,integer,text,integer,timestamptz,jsonb,bytea,text\)/u
  );
  assert.match(
    sql,
    /VALIDATE CONSTRAINT "rank_connector_executions_shape"/u
  );
  assert.doesNotMatch(sql, /claim_rank_connector_submit/u);
  assert.doesNotMatch(sql, /execution_connector_version\s*=/u);
});
