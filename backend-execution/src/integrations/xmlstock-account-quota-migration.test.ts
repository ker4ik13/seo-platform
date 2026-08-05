import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("XMLStock account quota migration keeps a strict provider metadata boundary", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260804191000_xmlstock_account_quota_metadata/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    migration,
    /finish_integration_credential_validation_success/u
  );
  assert.match(migration, /p_provider_meta - ''account'' - ''wordstat''/u);
  assert.match(migration, /requestLimit/u);
  assert.match(migration, /usedToday/u);
  assert.match(migration, /frozenBalance/u);
  assert.match(migration, /9007199254740991/u);
  assert.match(migration, /Invalid XMLStock validation metadata/u);
});

test("XMLStock account quota guard applies its nested allowlist to JSONB", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260804192000_xmlstock_account_quota_guard_precedence/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(migration, /\(p_provider_meta -> ''account''\) - ''requestLimit''/u);
  assert.match(migration, /ambiguous `unknown - unknown`/u);
  assert.match(migration, /pg_get_functiondef/u);
});
