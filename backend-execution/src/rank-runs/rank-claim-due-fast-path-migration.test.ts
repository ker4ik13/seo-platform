import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260922235500_rank_claim_due_fast_path/migration.sql",
    import.meta.url
  ),
  "utf8"
).replace(/\s+/gu, " ");

test("rank claim skips the full graph when no connector execution is due", () => {
  assert.match(
    migration,
    /CREATE INDEX rank_connector_executions_connector_submit_due_idx/u
  );
  assert.match(
    migration,
    /execution\.execution_connector_version = p_execution_connector_version/u
  );
  assert.match(
    migration,
    /execution\.authorization_expires_at > clock_timestamp\(\)/u
  );
  assert.match(migration, /IF NOT EXISTS/u);
  assert.match(
    migration,
    /claim_rank_connector_execution_pre_authorization\(text,integer,text\)/u
  );
});
