import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260804210000_rank_credential_refresh_fence/migration.sql",
  import.meta.url
);

test("automatic credential refresh is fenced by active rank execution", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const normalized = sql.replace(/\s+/gu, " ").trim();

  assert.match(
    normalized,
    /rank_job\."type" = 'MANUAL_RANK_CHECK'/u
  );
  assert.match(
    normalized,
    /rank_job\."status" IN \( 'PREPARING', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED' \)/u
  );
  assert.match(normalized, /rank_run\."finalization_status" IS NULL/u);
  assert.match(
    normalized,
    /estimate\."credential_id" = credential\."id"/u
  );
  assert.match(
    normalized,
    /estimate\."credential_material_version" = credential\."material_version"/u
  );
  assert.match(
    normalized,
    /REVOKE ALL ON FUNCTION public\.schedule_integration_credential_validation_refreshes/u
  );
  assert.doesNotMatch(
    normalized,
    /"(?:api_key|ciphertext|encrypted_data_key|auth_tag)"/iu
  );
});
