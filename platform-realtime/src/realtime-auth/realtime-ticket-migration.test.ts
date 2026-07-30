import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260730170000_realtime_project_tickets/migration.sql",
  import.meta.url
);

test("creates transactional hash-only one-time project tickets", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  assert.match(sql, /CREATE TABLE "realtime_project_tickets"/u);
  assert.match(sql, /octet_length\("ticket_hash"\) = 32/u);
  assert.match(sql, /octet_length\("origin_hash"\) = 32/u);
  assert.doesNotMatch(sql, /"ticket"\s+(?:TEXT|VARCHAR)/u);
  assert.doesNotMatch(sql, /FOREIGN KEY|REFERENCES/u);
});

test("enforces exact TTLs, immutable scope and mutually exclusive states", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(
    sql,
    /"expires_at" = "issued_at" \+ INTERVAL '30 seconds'/u
  );
  assert.match(
    sql,
    /"authorization_expires_at" = "issued_at" \+ INTERVAL '60 seconds'/u
  );
  assert.match(
    sql,
    /"session_expires_at" >= "authorization_expires_at"/u
  );
  assert.match(
    sql,
    /"invalidated_at" IS NULL[\s\S]*"consumed_at" IS NULL[\s\S]*"connection_id" IS NULL/u
  );
  assert.match(
    sql,
    /CREATE TRIGGER "realtime_project_ticket_scope_immutable"[\s\S]*BEFORE UPDATE/u
  );
});

test("bounds active scope, connection count lookups and retention", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(
    sql,
    /realtime_project_tickets_active_scope_key[\s\S]*"user_id"[\s\S]*"session_id"[\s\S]*"project_id"[\s\S]*"client_instance_id"[\s\S]*WHERE "consumed_at" IS NULL AND "invalidated_at" IS NULL/u
  );
  assert.match(
    sql,
    /realtime_project_tickets_active_user_lease_idx[\s\S]*WHERE "consumed_at" IS NOT NULL AND "disconnected_at" IS NULL/u
  );
  assert.match(sql, /realtime_project_tickets_retention_idx/u);
});
