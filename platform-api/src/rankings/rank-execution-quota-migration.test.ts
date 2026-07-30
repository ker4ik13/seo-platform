import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("controlled-beta rank quota reservations are immutable and receipt-bound", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260730223000_rank_beta_quota_reservations/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(
    sql,
    /CREATE TABLE "rank_execution_quota_reservations"/u
  );
  assert.match(
    sql,
    /"policy_version" =[\s\S]*'manual-arsenkin-positions@1\.0\.0'/u
  );
  assert.match(
    sql,
    /FOREIGN KEY \([\s\S]*"quota_reservation_id",[\s\S]*"workspace_id",[\s\S]*"project_id",[\s\S]*"actor_id",[\s\S]*"job_id",[\s\S]*"job_item_id",[\s\S]*"execution_attempt",[\s\S]*"policy_version"[\s\S]*\)[\s\S]*REFERENCES "rank_execution_quota_reservations"/u
  );
  assert.match(
    sql,
    /BEFORE UPDATE OR DELETE ON "rank_execution_quota_reservations"/u
  );
  assert.match(
    sql,
    /BEFORE TRUNCATE ON "rank_execution_quota_reservations"/u
  );
  assert.match(sql, /COMMIT;\s*$/u);
});
