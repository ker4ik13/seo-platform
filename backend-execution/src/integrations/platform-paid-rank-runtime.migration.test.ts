import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260827124500_platform_paid_rank_runtime/migration.sql",
  import.meta.url
);

test("platform-paid rank migration widens only the fenced rank runtime", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const normalized = sql.replace(/\s+/gu, " ").trim();

  assert.match(normalized, /^BEGIN;/u);
  assert.match(normalized, /COMMIT;$/u);
  assert.match(
    normalized,
    /credential_mode IN \('BYOK_API_KEY', 'PLATFORM_PAID'\)/u
  );
  assert.match(
    normalized,
    /integration_credentials_workspace_platform_provider_active_key/u
  );
  assert.match(
    normalized,
    /WHERE mode = 'PLATFORM_PAID' AND deleted_at IS NULL/u
  );
  assert.match(
    normalized,
    /rank_execution_grant_request_is_exact\(jsonb,uuid,uuid,uuid,uuid,integer,integer,bytea\)/u
  );
  assert.match(normalized, /assert_manual_rank_job_shape\(\)/u);
  assert.match(
    normalized,
    /mod\(NEW\."estimated_cost_micro", 10000\) <> 0/u
  );
  assert.match(normalized, /assert_rank_connector_execution_scope\(\)/u);
  assert.match(
    normalized,
    /schedule_integration_credential_validation_refreshes\(uuid\[\],timestamptz,jsonb,text,integer\)/u
  );
  assert.match(
    normalized,
    /estimate\.credential_mode = job\.credential_mode/u
  );
  assert.match(
    normalized,
    /validation\.credential_mode = job\.credential_mode/u
  );
  assert.match(
    normalized,
    /CREATE FUNCTION public\.read_rank_connector_billing_settlement\(/u
  );
  assert.match(
    normalized,
    /attempt\."decision_snapshot" #>> '\{grant,id\}'/u
  );
  assert.match(
    normalized,
    /job\."credential_mode" IN \('BYOK_API_KEY', 'PLATFORM_PAID'\)/u
  );
  assert.match(
    normalized,
    /execution\."status" IN \('CLAIMED', 'FETCHING'\)/u
  );
  assert.match(
    normalized,
    /execution\."status" <> 'FETCHING' OR execution\."provider_task_id" IS NOT NULL/u
  );
  assert.match(
    normalized,
    /REVOKE ALL ON FUNCTION public\.read_rank_connector_billing_settlement/u
  );
  assert.doesNotMatch(
    normalized,
    /"(?:api_key|account_identifier|ciphertext|encrypted_data_key)"/iu
  );
});
