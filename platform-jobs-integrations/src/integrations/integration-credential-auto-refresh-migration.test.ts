import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260804190000_integration_credential_auto_refresh/migration.sql",
  import.meta.url
);

test("auto refresh migration creates a bounded secret-free validation scheduler", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const normalized = sql.replace(/\s+/gu, " ").trim();

  assert.match(normalized, /SECURITY DEFINER SET search_path = pg_catalog, pg_temp/u);
  assert.match(normalized, /p_reason NOT IN \('HOURLY', 'PROVIDER_OPERATION'\)/u);
  assert.match(normalized, /p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500/u);
  assert.match(normalized, /cardinality\(p_credential_ids\) > 500/u);
  assert.match(normalized, /active\."status" IN \( 'QUEUED', 'WAITING_RATE_LIMIT', 'RUNNING', 'RETRY_SCHEDULED' \)/u);
  assert.match(normalized, /'kind', 'integration\.credential\.validation\.v1'/u);
  assert.match(normalized, /REVOKE ALL ON FUNCTION public\.schedule_integration_credential_validation_refreshes/u);
  assert.doesNotMatch(
    normalized,
    /"(?:api_key|ciphertext|encrypted_data_key|auth_tag)"/iu
  );
});
