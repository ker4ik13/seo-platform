import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260922233000_rank_submit_idle_fast_path/migration.sql",
    import.meta.url
  ),
  "utf8"
).replace(/\s+/gu, " ");

test("rank submit checks indexed due work before the Arsenkin advisory lock", () => {
  const fastPath = migration.indexOf("IF NOT EXISTS");
  const providerLock = migration.lastIndexOf("PERFORM pg_advisory_xact_lock");
  assert.ok(fastPath > 0);
  assert.ok(providerLock > fastPath);
  assert.match(migration, /execution\.status = 'READY_TO_SUBMIT'/u);
  assert.match(migration, /execution\.lease_expires_at <= clock_timestamp\(\)/u);
  assert.match(migration, /authorization_expires_at/u);
  assert.match(
    migration,
    /claim_rank_connector_submit_bounded\(text,integer,text\)/u
  );
});
