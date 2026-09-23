import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260922224500_append_existing_credentials_to_workspace_routes/migration.sql",
    import.meta.url
  ),
  "utf8"
).replace(/\s+/gu, " ");

test("backfills compatible credentials at the end without changing the primary route", () => {
  assert.match(migration, /ORDER BY missing\."created_at", missing\."credential_id"/u);
  assert.match(
    migration,
    /ordered\."tail" \+ ordered\."append_offset"::integer/u
  );
  assert.match(migration, /ordered\."tail" \+ ordered\."append_offset" <= 7/u);
  assert.match(migration, /ON CONFLICT DO NOTHING/u);
  assert.match(migration, /"fallback_mode" = 'NEXT_AVAILABLE'/u);
  assert.match(
    migration,
    /p_credential_ids IS NULL OR credential\."id" = ANY\(p_credential_ids\)/u
  );
  assert.match(migration, /Credential refresh requires a stale boundary/u);
  assert.doesNotMatch(migration, /UPDATE public\.integration_credentials/u);
});
