import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260801210000_arsenkin_wordstat_capability_guard/migration.sql",
  import.meta.url
);

test("preserves Wordstat after every successful Arsenkin validation", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const normalized = sql.replaceAll(/\s+/gu, " ").trim();

  assert.ok(
    normalized.includes(
      'CREATE TRIGGER "integration_credential_arsenkin_wordstat_capability" BEFORE INSERT OR UPDATE OF "provider", "status", "verified_at", "capabilities" ON public.integration_credentials'
    )
  );
  assert.ok(normalized.includes('NEW."provider" = \'ARSENKIN\''));
  assert.ok(normalized.includes('NEW."status" = \'ACTIVE\''));
  assert.ok(normalized.includes('NEW."verified_at" IS NOT NULL'));
  assert.ok(
    normalized.includes(
      'NEW."capabilities" := NEW."capabilities" || \'["WORDSTAT"]\'::JSONB'
    )
  );
  assert.ok(
    normalized.includes(
      "REVOKE ALL ON FUNCTION public.ensure_arsenkin_wordstat_capability() FROM PUBLIC"
    )
  );
  assert.ok(
    normalized.includes(
      'UPDATE public.integration_credentials SET "capabilities" = "capabilities" || \'["WORDSTAT"]\'::JSONB'
    )
  );
});
