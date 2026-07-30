import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260730130000_auth_email_delivery_attempts/migration.sql",
  import.meta.url
);
const migration = readFile(MIGRATION, "utf8");

test("persists only redacted auth-email delivery state", async () => {
  const sql = await migration;
  const tableStart = sql.indexOf('CREATE TABLE "auth_email_delivery_attempts"');
  const tableEnd = sql.indexOf(");", tableStart);
  assert.ok(tableStart >= 0 && tableEnd > tableStart);
  const table = sql.slice(tableStart, tableEnd).toLowerCase();

  for (const forbidden of [
    "recipient",
    "email_address",
    "token",
    "action_url",
    "subject",
    "body",
    "html"
  ]) {
    assert.equal(table.includes(`"${forbidden}"`), false, forbidden);
  }
  for (const required of [
    '"source_event_id"',
    '"source_event_hash"',
    '"provider_message_id"',
    '"last_error_code"'
  ]) {
    assert.ok(table.includes(required), required);
  }
});

test("fences claims, freezes SMTP receipts and terminal states", async () => {
  const normalized = (await migration).replace(/\s+/gu, " ");
  for (const required of [
    'octet_length("source_event_hash") = 32',
    '"provider_message_id" IS NULL) = ("smtp_accepted_at" IS NULL',
    'NEW."version" <> OLD."version" + 1',
    'NEW."attempts" > OLD."attempts" + 1',
    "OLD.\"status\" = 'PENDING' AND NEW.\"status\" = 'SENDING'",
    "OLD.\"status\" = 'DLQ_PENDING' AND NEW.\"status\" IN ('DLQ_PENDING', 'FAILED_FINAL')",
    "auth email attempt increment requires a claimed delivery state",
    'OLD."provider_message_id" IS NOT NULL',
    "OLD.\"status\" IN ('COMPLETED', 'CANCELLED', 'FAILED_FINAL')",
    "REVOKE ALL ON FUNCTION public.guard_auth_email_delivery_attempt() FROM PUBLIC"
  ]) {
    assert.ok(normalized.includes(required), required);
  }
});
