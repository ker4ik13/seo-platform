import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260820143000_arsenkin_clustering_capability/migration.sql",
  import.meta.url
);

test("persists clustering on verified Arsenkin credentials", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const normalized = sql.replaceAll(/\s+/gu, " ").trim();

  assert.match(
    normalized,
    /finish_integration_credential_validation_success/u
  );
  assert.match(
    normalized,
    /\["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT","CLUSTERING"\]/u
  );
  assert.ok(
    normalized.includes(
      "ALTER FUNCTION public.ensure_arsenkin_wordstat_capability() RENAME TO ensure_arsenkin_persisted_capabilities"
    )
  );
  assert.ok(
    normalized.includes(
      'ALTER TRIGGER "integration_credential_arsenkin_wordstat_capability" ON public.integration_credentials RENAME TO "integration_credential_arsenkin_persisted_capabilities"'
    )
  );
  assert.ok(normalized.includes("NOT NEW.\"capabilities\" ? 'CLUSTERING'"));
  assert.ok(
    normalized.includes(
      "REVOKE ALL ON FUNCTION public.ensure_arsenkin_persisted_capabilities() FROM PUBLIC"
    )
  );
  assert.match(
    normalized,
    /UPDATE public\.integration_credentials SET .*\["CLUSTERING"\].*WHERE "provider" = 'ARSENKIN'.*"status" = 'ACTIVE'.*"verified_at" IS NOT NULL.*"deleted_at" IS NULL/u
  );
});
