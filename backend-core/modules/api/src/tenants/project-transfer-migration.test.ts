import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("project ownership transfer migration backfills owners and serializes pending requests", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260805160000_project_ownership_transfer/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(sql, /SET "owner_user_id" = workspace\."owner_user_id"/u);
  assert.match(sql, /ALTER COLUMN "owner_user_id" SET NOT NULL/u);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "project_transfer_requests_one_pending_per_project_key"[\s\S]*WHERE "status" = 'PENDING'/u
  );
  assert.match(sql, /project_transfer_requests_distinct_users_check/u);
  assert.match(sql, /project_transfer_requests_terminal_state_check/u);
});
