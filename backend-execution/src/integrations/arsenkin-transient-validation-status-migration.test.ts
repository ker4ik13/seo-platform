import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260910070000_arsenkin_transient_validation_status/migration.sql",
  import.meta.url
);

test("verified Arsenkin credentials remain routable during transient validation failures", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const normalized = sql.replace(/\s+/gu, " ").trim();

  assert.match(
    normalized,
    /pg_get_functiondef\( 'public\.finish_integration_credential_validation_provider_failure\(uuid,text,uuid,integer,text,text,integer\)'::regprocedure \)/u
  );
  assert.ok(sql.includes("keep_verified_arsenkin_active :="));
  assert.ok(
    sql.includes("current_credential.\"provider\" = ''ARSENKIN''")
  );
  assert.ok(
    sql.includes(
      "current_credential.\"status\" IN (''ACTIVE'', ''RATE_LIMITED'')"
    )
  );
  assert.ok(sql.includes("WHEN keep_verified_arsenkin_active THEN NULL"));
  assert.ok(
    sql.includes("THEN ''ACTIVE''::public.\"CredentialStatus\"")
  );
  assert.match(
    normalized,
    /UPDATE public\.integration_credentials credential SET "status" = 'ACTIVE'.*credential\."provider" = 'ARSENKIN'.*credential\."verified_at" IS NOT NULL.*credential\."status" = 'RATE_LIMITED'.*credential\."last_error_code" = 'PROVIDER_RATE_LIMITED'/u
  );
  assert.match(normalized, /USING ERRCODE = '55000'/u);
});
