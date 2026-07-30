import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260730101600_integration_credential_validation_broker/migration.sql",
  import.meta.url
);
const migration = readFile(MIGRATION, "utf8");

test("stores only immutable synthetic KEK canaries", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);
  const tableStart = sql.indexOf(
    "CREATE TABLE public.integration_credential_kek_canaries"
  );
  const tableEnd = sql.indexOf(");", tableStart);
  assert.ok(tableStart >= 0 && tableEnd > tableStart);
  const table = sql.slice(tableStart, tableEnd);

  for (const forbidden of ["workspace", "credential_id", "provider"]) {
    assert.equal(table.includes(forbidden), false);
  }
  assert.ok(
    normalized.includes(
      `CREATE TRIGGER "integration_credential_kek_canary_immutable" BEFORE UPDATE OR DELETE`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE TRIGGER "integration_credential_kek_canary_no_truncate" BEFORE TRUNCATE`
    )
  );
  assert.ok(normalized.includes(`ON CONFLICT ("key_version") DO NOTHING`));
});

test("hardens every broker function against caller search_path", async () => {
  const sql = await migration;
  const functions = [
    "list_integration_credential_key_versions",
    "register_integration_credential_kek_canary",
    "list_integration_credential_execution_kek_canaries",
    "list_due_integration_credential_validations",
    "claim_integration_credential_validation",
    "finish_integration_credential_validation_job_failure",
    "finish_integration_credential_validation_provider_failure",
    "finish_integration_credential_validation_success"
  ];
  for (const functionName of functions) {
    const start = sql.indexOf(`CREATE FUNCTION public.${functionName}(`);
    assert.ok(start >= 0, `Missing ${functionName}`);
    const end = sql.indexOf("$$;", start);
    assert.ok(end > start, `Incomplete ${functionName}`);
    const body = compactSql(sql.slice(start, end));
    assert.ok(body.includes("SECURITY DEFINER"), functionName);
    assert.ok(
      body.includes("SET search_path = pg_catalog, pg_temp"),
      functionName
    );
  }
  assert.equal(sql.includes("public.uuidv7()"), false);
  assert.ok(sql.includes("pg_catalog.uuidv7()"));
});

test("hardens the deferred jobs trigger reached by broker finishes", async () => {
  const normalized = compactSql(await migration);
  assert.ok(
    normalized.includes(
      `CREATE OR REPLACE FUNCTION public.assert_manual_rank_job_has_run() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp`
    )
  );
  for (const required of [
    "FROM public.jobs j",
    "JOIN public.rank_job_runs r",
    "JOIN public.rank_estimates e",
    "public.manual_rank_job_state_is_coherent("
  ]) {
    assert.ok(normalized.includes(required), `Missing ${required}`);
  }
  assert.ok(
    normalized.includes(
      "REVOKE ALL ON FUNCTION public.assert_manual_rank_job_has_run() FROM PUBLIC;"
    )
  );
});

test("bounds execution canary requests and returns requested union used", async () => {
  const sql = await migration;
  const start = sql.indexOf(
    "CREATE FUNCTION public.list_integration_credential_execution_kek_canaries("
  );
  const end = sql.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start);
  const body = compactSql(sql.slice(start, end));

  for (const required of [
    "p_requested_key_versions TEXT[]",
    '"usedByCredential" BOOLEAN',
    "pg_catalog.cardinality(p_requested_key_versions) > 128",
    "pg_catalog.array_ndims(p_requested_key_versions) <> 1",
    "pg_catalog.pg_input_is_valid(requested.value, 'integer')",
    "pg_catalog.count(DISTINCT requested.value)",
    "SELECT pg_catalog.count(*) > 128 FROM target_versions",
    "FROM requested_versions requested UNION SELECT used.\"key_version\" FROM used_versions used",
    'used."key_version" IS NOT NULL',
    'WHERE credential."deleted_at" IS NULL'
  ]) {
    assert.ok(body.includes(required), `Missing ${required}`);
  }
  assert.ok(
    sql.includes(
      "public.list_integration_credential_execution_kek_canaries(TEXT[])"
    )
  );
  assert.equal(
    sql.includes(
      "public.list_integration_credential_execution_kek_canaries()"
    ),
    false
  );
});

test("claims one exact validation and returns material only for READY", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);
  for (const required of [
    `job."id" = p_validation_id`,
    `job."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'`,
    `FOR UPDATE OF job`,
    `"validation_lease_token" = claimed_token`,
    `"attempt" = job."attempt" + 1`,
    `credential."workspace_id" = current_job."workspace_id"`,
    `credential."id" = parsed_credential_id`,
    `CASE WHEN scope_state = 'READY' THEN current_credential."ciphertext" ELSE NULL END`
  ]) {
    assert.ok(normalized.includes(required), `Missing ${required}`);
  }
  for (const required of [
    `->> 'kind' IS DISTINCT FROM`,
    `current_job."provider" IS NULL`,
    `current_job."deduplication_key" IS DISTINCT FROM`,
    `current_credential."provider" IS DISTINCT FROM current_job."provider"`
  ]) {
    assert.ok(normalized.includes(required), `Missing ${required}`);
  }
  assert.ok(normalized.includes(`"leaseExpiresAt" TIMESTAMPTZ`));
  const claimStart = sql.indexOf(
    "CREATE FUNCTION public.claim_integration_credential_validation("
  );
  const claimEnd = sql.indexOf("$$;", claimStart);
  const claimBody = sql.slice(claimStart, claimEnd);
  const claimableBranch = claimBody.indexOf(
    "-- Keep the canonical Job -> credential lock order"
  );
  const credentialLock = claimBody.indexOf(
    "FOR SHARE OF credential;",
    claimableBranch
  );
  const freshClock = claimBody.indexOf(
    "now_at := clock_timestamp();",
    credentialLock
  );
  const tokenIssue = claimBody.indexOf(
    "claimed_token := pg_catalog.uuidv7();",
    freshClock
  );
  assert.ok(
    claimableBranch >= 0 &&
      credentialLock > claimableBranch &&
      freshClock > credentialLock &&
      tokenIssue > freshClock,
    "lease identity must be issued only after the credential lock wait"
  );
});

test("fences every finish by owner, token, version and live lease", async () => {
  const sql = await migration;
  for (const functionName of [
    "finish_integration_credential_validation_job_failure",
    "finish_integration_credential_validation_provider_failure",
    "finish_integration_credential_validation_success"
  ]) {
    const start = sql.indexOf(`CREATE FUNCTION public.${functionName}(`);
    const end = sql.indexOf("$$;", start);
    const body = compactSql(sql.slice(start, end));
    for (const required of [
      `job."lease_owner" = p_lease_owner`,
      `job."validation_lease_token" = p_lease_token`,
      `job."version" = p_expected_job_version`,
      `job."lease_expires_at" > clock_timestamp()`,
      `FOR UPDATE OF job`
    ]) {
      assert.ok(body.includes(required), `${functionName}: ${required}`);
    }
  }
  assert.ok(sql.includes("IF p_error_code IS NULL OR p_error_code NOT IN"));
  assert.ok(sql.includes(") IS NOT TRUE THEN"));
});

test("requires exact normalized Arsenkin metadata before activation", async () => {
  const sql = await migration;
  const start = sql.indexOf(
    "CREATE FUNCTION public.finish_integration_credential_validation_success("
  );
  const end = sql.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start);
  const body = compactSql(sql.slice(start, end));

  for (const required of [
    `IF p_provider_meta IS NULL`,
    `jsonb_typeof(p_provider_meta) IS DISTINCT FROM 'object'`,
    `NOT p_provider_meta ? 'limitsTotal'`,
    `p_provider_meta - 'limitsTotal' <> '{}'::JSONB`,
    `jsonb_typeof(p_provider_meta -> 'limitsTotal') IS DISTINCT FROM 'number'`,
    `p_provider_meta ->> 'limitsTotal' !~ '^(0|[1-9][0-9]{0,15})$'`,
    `(p_provider_meta ->> 'limitsTotal')::NUMERIC > 9007199254740991`
  ]) {
    assert.ok(body.includes(required), `Missing ${required}`);
  }
});

test("serializes retry deadlines as UTC and revokes PUBLIC execution", async () => {
  const sql = await migration;
  assert.equal(
    sql.match(/retry_at_value AT TIME ZONE 'UTC'/gu)?.length,
    2
  );
  assert.equal(
    sql.match(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC;/gu)?.length,
    10
  );
  assert.ok(
    sql.includes(
      "REVOKE ALL ON TABLE public.integration_credential_kek_canaries FROM PUBLIC;"
    )
  );
  assert.match(sql, /\nCOMMIT;\s*$/u);
});

function compactSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}
