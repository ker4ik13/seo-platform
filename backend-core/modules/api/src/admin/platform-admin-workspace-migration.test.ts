import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform admin command receipts persist idempotent mutations", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260805203000_platform_admin_workspace_subscriptions/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /CREATE TABLE "platform_admin_command_receipts"/u);
  assert.match(sql, /CHECK \(octet_length\("request_hash"\) = 32\)/u);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "platform_admin_command_receipts_actor_action_key"/u
  );
  assert.match(sql, /platform admin command receipts are immutable/u);
  assert.match(sql, /platform admin command receipts cannot be truncated/u);
  assert.match(sql, /USING ERRCODE = '55000'/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
