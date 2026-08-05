import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260805103000_rank_grant_safe_unused_retry/migration.sql",
  import.meta.url
);

test("allows a new grant only after a provably unused expired authorization", async () => {
  const sql = await readFile(migration, "utf8");

  assert.match(sql, /CREATE OR REPLACE FUNCTION "protect_rank_execution_grant_attempt"/u);
  assert.match(sql, /prior\."status" = 'CONSUMED'/u);
  assert.match(sql, /execution\."status" IN \('READY_TO_SUBMIT', 'CLAIMED'\)/u);
  assert.match(sql, /execution\."authorization_expires_at" <= clock_timestamp\(\)/u);
  assert.match(sql, /execution\."submit_attempt_count" = 0/u);
  assert.match(sql, /execution\."submit_bytes_started_at" IS NULL/u);
  assert.match(sql, /execution\."provider_task_id" IS NULL/u);
  assert.doesNotMatch(sql, /UPDATE "rank_execution_grant_attempts"/u);
  assert.doesNotMatch(sql, /DELETE FROM "rank_/u);
});
