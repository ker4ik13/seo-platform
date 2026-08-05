import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260730101800_rank_connector_submit_authorization/migration.sql",
  import.meta.url
);

const ENUM_MIGRATION = new URL(
  "../../prisma/migrations/20260730101700_rank_connector_submitting_enum/migration.sql",
  import.meta.url
);

const migration = readFile(MIGRATION, "utf8");
const enumMigration = readFile(ENUM_MIGRATION, "utf8");

function compactSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function authorizeSql(sql: string): string {
  const start = sql.indexOf(
    "CREATE FUNCTION public.authorize_rank_connector_execution_submit("
  );
  const end = sql.indexOf(
    'CREATE TRIGGER "rank_connector_execution_claim_transition_guard"',
    start
  );
  assert.ok(start >= 0 && end > start);
  return sql.slice(start, end);
}

test("commits the SUBMITTING enum expansion in its own Prisma migration", async () => {
  assert.equal(
    compactSql(await enumMigration),
    `ALTER TYPE "RankConnectorExecutionStatus" ADD VALUE IF NOT EXISTS 'SUBMITTING';`
  );
});

test("stores one-way submit evidence in a separate transactional contract migration", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /\sCOMMIT;\s*$/u);

  for (const required of [
    `ADD COLUMN "lease_generation" INTEGER`,
    `ADD COLUMN "submit_attempt_count" INTEGER NOT NULL DEFAULT 0`,
    `ADD COLUMN "submit_bytes_started_at" TIMESTAMPTZ(6)`,
    `"status" = 'SUBMITTING'`,
    `"submit_attempt_count" = 1`,
    `"submit_bytes_started_at" IS NOT NULL`,
    `"submit_bytes_started_at" < "lease_expires_at"`,
    `"version" = "lease_generation" + 2`
  ]) {
    assert.ok(normalized.includes(required), `Missing ${required}`);
  }
  assert.ok(
    normalized.includes(
      `after commit provider bytes may have started; automatic submit replay is forbidden.`
    )
  );
});

test("replaces the lifecycle guard and makes claim generations monotonic", async () => {
  const normalized = compactSql(await migration);

  assert.ok(
    normalized.includes(
      `DROP TRIGGER "rank_connector_execution_claim_transition_guard" ON public.rank_connector_executions`
    )
  );
  assert.ok(
    normalized.includes(
      `NEW."lease_generation" := OLD."lease_generation" + 1`
    )
  );
  assert.ok(
    normalized.includes(
      `OLD."status" = 'CLAIMED' AND OLD."lease_expires_at" <= clock_timestamp()`
    )
  );
  assert.ok(
    normalized.includes(
      `OLD."status" <> 'CLAIMED' OR NEW."version" <> OLD."version" + 1`
    )
  );
  assert.ok(
    normalized.includes(
      `ALTER FUNCTION public.claim_rank_connector_execution(TEXT, INTEGER, TEXT) RENAME TO claim_rank_connector_execution_pre_authorization`
    )
  );
  assert.ok(normalized.includes(`"leaseGeneration" INTEGER`));
  assert.ok(normalized.includes(`"executionVersion" INTEGER`));
  assert.ok(
    normalized.includes(
      `FROM public.claim_rank_connector_execution_pre_authorization(`
    )
  );
  assert.ok(
    normalized.includes(
      `execution."lease_generation", execution."version" INTO claimed_generation, claimed_version FROM public.rank_connector_executions execution`
    )
  );
});

test("authorizes one exact active lease and persists the marker before a secret-free permit", async () => {
  const sql = authorizeSql(await migration);
  const normalized = compactSql(sql);

  assert.ok(
    normalized.includes(
      `p_workspace_id UUID, p_execution_id UUID, p_lease_owner TEXT, p_lease_token UUID, p_lease_generation INTEGER, p_expected_version INTEGER, p_execution_connector_version TEXT`
    )
  );
  assert.ok(normalized.includes(`LANGUAGE plpgsql SECURITY DEFINER`));
  assert.ok(normalized.includes(`SET search_path = pg_catalog, pg_temp`));
  assert.ok(normalized.includes(`USING ERRCODE = '22023'`));
  assert.ok(normalized.includes(`job."status" = 'RUNNING'`));
  assert.ok(
    normalized.includes(`job."stage" = 'WAITING_EXECUTION_GRANT'`)
  );
  assert.ok(normalized.includes(`"status" = 'SUBMITTING'`));
  assert.ok(normalized.includes(`"submit_attempt_count" = 1`));
  assert.ok(
    normalized.includes(`"submit_bytes_started_at" = v_authorized_at`)
  );
  assert.ok(
    normalized.includes(`execution."version" = p_expected_version`)
  );

  const returnsStart = sql.indexOf("RETURNS TABLE (");
  const returnsEnd = sql.indexOf(")\nLANGUAGE plpgsql", returnsStart);
  assert.ok(returnsStart >= 0 && returnsEnd > returnsStart);
  const permitShape = sql.slice(returnsStart, returnsEnd);
  assert.doesNotMatch(
    permitShape,
    /credential|ciphertext|nonce|authTag|encryptedDataKey|providerTask|payload/iu
  );

  const permitStart = sql.indexOf(
    "-- This permit is intentionally secret-free."
  );
  assert.ok(permitStart >= 0);
  const permitProjection = sql.slice(permitStart);
  assert.doesNotMatch(
    permitProjection,
    /ciphertext|nonce|auth_tag|encrypted_data_key|provider_request/iu
  );
});

test("locks the exact current graph in canonical order and rechecks every boundary", async () => {
  const sql = authorizeSql(await migration);
  const markers = [
    "rank-connector-authorize:job",
    "rank-connector-authorize:run",
    "rank-connector-authorize:item",
    "rank-connector-authorize:credential",
    "rank-connector-authorize:validation",
    "rank-connector-authorize:binding",
    "rank-connector-authorize:route",
    "rank-connector-authorize:grant",
    "rank-connector-authorize:execution",
    "rank-connector-authorize:control"
  ];
  let previous = -1;
  for (const marker of markers) {
    const current = sql.indexOf(marker);
    assert.ok(current > previous, `Invalid lock order at ${marker}`);
    previous = current;
  }

  for (const relation of [
    "public.jobs",
    "public.rank_job_runs",
    "public.job_items",
    "public.integration_credentials",
    "public.project_connector_bindings",
    "public.project_connector_routes",
    "public.rank_execution_grant_attempts",
    "public.rank_connector_executions",
    "public.rank_connector_execution_controls"
  ]) {
    assert.ok(sql.includes(relation), `Missing qualified ${relation}`);
  }

  assert.match(sql, /All potentially blocking locks are held/u);
  assert.match(sql, /IF NOT EXISTS \(\s*SELECT 1\s*FROM public\.jobs job/u);
});

test("keeps both public boundaries default-closed", async () => {
  const normalized = compactSql(await migration);

  assert.ok(
    normalized.includes(
      `REVOKE ALL ON FUNCTION public.claim_rank_connector_execution(TEXT, INTEGER, TEXT) FROM PUBLIC`
    )
  );
  assert.ok(
    normalized.includes(
      `REVOKE ALL ON FUNCTION public.authorize_rank_connector_execution_submit( UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT ) FROM PUBLIC`
    )
  );
  assert.ok(
    normalized.includes(
      `REVOKE ALL ON FUNCTION public.claim_rank_connector_execution_pre_authorization( TEXT, INTEGER, TEXT ) FROM PUBLIC`
    )
  );
});

test("revokes inherited non-owner ACLs from the renamed claim primitive", async () => {
  const normalized = compactSql(await migration);

  for (const required of [
    `ALTER FUNCTION public.claim_rank_connector_execution(TEXT, INTEGER, TEXT) RENAME TO claim_rank_connector_execution_pre_authorization`,
    `CROSS JOIN LATERAL pg_catalog.aclexplode(`,
    `pg_catalog.acldefault('f', procedure.proowner)`,
    `privilege.grantee <> procedure.proowner`,
    `REVOKE ALL ON FUNCTION public.claim_rank_connector_execution_pre_authorization(text,integer,text) FROM %I`
  ]) {
    assert.ok(normalized.includes(required), `Missing ${required}`);
  }
});
