import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260803111500_rank_bounded_submit_request/migration.sql",
  import.meta.url
);

test("bounded rank dispatch can read one claimed immutable request", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /execution\."status" = 'CLAIMED'/u);
  assert.match(sql, /execution\."authorization_expires_at" > clock_timestamp\(\)/u);
  assert.match(sql, /execution\."provider_request_intent_hash"/u);
  assert.doesNotMatch(sql, /NOT EXISTS/u);
  assert.doesNotMatch(sql, /rank_connector_executions sibling/u);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION[\s\S]*read_rank_connector_submit_request/u
  );
});
