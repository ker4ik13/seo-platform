import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260729160000_revoked_session_family_tombstones/migration.sql",
  import.meta.url
);

test("creates an atomic durable session-family tombstone migration", async () => {
  const migration = await readFile(MIGRATION, "utf8");

  assert.match(migration, /^BEGIN;/u);
  assert.match(
    migration,
    /PRIMARY KEY \("user_id", "session_family_id"\)/u
  );
  assert.match(migration, /UNIQUE \("source_event_id"\)/u);
  assert.match(
    migration,
    /"received_at" TIMESTAMPTZ\(6\) NOT NULL DEFAULT CURRENT_TIMESTAMP/u
  );
  assert.match(
    migration,
    /ALTER TABLE "inbox_events"[\s\S]*ADD COLUMN "scope_key" VARCHAR\(180\)/u
  );
  assert.match(
    migration,
    /isfinite\("revoked_at"\)[\s\S]*isfinite\("received_at"\)[\s\S]*"revoked_at" <= "received_at" \+ INTERVAL '5 minutes'/u
  );
  assert.match(migration, /COMMIT;\s*$/u);
});

test("keeps tombstone retention independent from inbox cleanup", async () => {
  const migration = await readFile(MIGRATION, "utf8");

  assert.match(
    migration,
    /revoked_session_family_tombstones_retention_idx[\s\S]*"received_at",[\s\S]*"user_id",[\s\S]*"session_family_id"/u
  );
  assert.doesNotMatch(migration, /REFERENCES "inbox_events"/u);
});

test("indexes the bounded active-device lookup by user and session family", async () => {
  const migration = await readFile(MIGRATION, "utf8");

  assert.match(
    migration,
    /web_push_subscriptions_user_family_status_idx[\s\S]*"user_id",[\s\S]*"registered_session_family_id",[\s\S]*"status"/u
  );
});
