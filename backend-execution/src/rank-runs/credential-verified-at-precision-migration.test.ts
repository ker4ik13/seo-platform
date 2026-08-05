import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260801201000_credential_verified_at_precision/migration.sql",
  import.meta.url
);

test("canonicalizes credential verification evidence to contract precision", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /BEFORE INSERT OR UPDATE OF "verified_at"[\s\S]*integration_credentials/u
  );
  assert.match(sql, /date_trunc\('milliseconds', NEW\."verified_at"\)/u);
  assert.match(
    sql,
    /UPDATE public\.integration_credentials[\s\S]*date_trunc\('milliseconds', "verified_at"\)/u
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION[\s\S]*canonicalize_credential_verified_at/u
  );
});
