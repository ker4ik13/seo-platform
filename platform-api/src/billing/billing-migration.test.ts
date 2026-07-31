import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("billing foundation is atomic, balanced and append-only", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260731023000_billing_foundation/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(
    sql,
    /posted ledger transaction must contain balanced entries in one currency/u
  );
  assert.match(
    sql,
    /BEFORE INSERT OR UPDATE OR DELETE ON "billing_ledger_entries"/u
  );
  assert.match(
    sql,
    /BEFORE INSERT OR UPDATE OR DELETE ON "billing_ledger_transactions"/u
  );
  assert.match(
    sql,
    /BEFORE TRUNCATE ON "billing_ledger_entries"/u
  );
  assert.match(
    sql,
    /BEFORE TRUNCATE ON "billing_ledger_transactions"/u
  );
  assert.match(
    sql,
    /COALESCE\("workspace_id", '00000000-0000-0000-0000-000000000000'::uuid\)/u
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "billing_trial_claims_owner_user_id_key"/u
  );
  assert.equal(
    (sql.match(/INSERT INTO "billing_plans"/gu) ?? []).length,
    1
  );
  assert.match(sql, /COMMIT;\s*$/u);
});
