import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260730101500_rank_connector_execution_claim/migration.sql",
  import.meta.url
);

const migration = readFile(MIGRATION, "utf8");

function compactSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

test("expands connector claims behind a versioned default-closed DB control", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);

  assert.match(
    sql,
    /^--[\s\S]*ALTER TYPE "RankConnectorExecutionStatus"[\s\S]*ADD VALUE IF NOT EXISTS 'CLAIMED';\s*BEGIN;/u
  );
  assert.match(sql, /\sCOMMIT;\s*$/u);
  assert.ok(
    normalized.includes(
      `CREATE TABLE "rank_connector_execution_controls" (`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE TABLE "rank_connector_execution_control_versions" (`
    )
  );
  assert.ok(
    normalized.includes(
      `VALUES ( 'ARSENKIN', 'SERP_RANK_TRACKING', FALSE, 'arsenkin-positions@1.0.0', 'manual-arsenkin-positions@1.0.0', 'arsenkin-positions@1', 1 );`
    )
  );
  assert.ok(
    normalized.includes(
      `NEW."kill_switch_version" = OLD."kill_switch_version"`
    )
  );
  assert.match(
    normalized,
    /CREATE TRIGGER "rank_connector_execution_control_no_truncate" BEFORE TRUNCATE/u
  );
  assert.ok(
    normalized.includes(
      `INSERT INTO public.rank_connector_execution_control_versions (`
    )
  );
  assert.match(
    normalized,
    /CREATE TRIGGER "rank_connector_execution_control_insert_history" AFTER INSERT ON "rank_connector_execution_controls"/u
  );
  assert.ok(
    normalized.includes(
      `REVOKE ALL ON FUNCTION "record_rank_connector_execution_control_insert"() FROM PUBLIC;`
    )
  );
  assert.ok(
    normalized.includes(
      `PRIMARY KEY ("provider", "capability", "kill_switch_version")`
    )
  );
  assert.match(
    normalized,
    /CREATE TRIGGER "rank_connector_execution_control_version_immutable" BEFORE UPDATE OR DELETE/u
  );
});

test("adds an exact renewable pre-network CLAIMED lease transition", async () => {
  const normalized = compactSql(await migration);

  for (const required of [
    `ADD COLUMN "lease_owner" VARCHAR(100)`,
    `ADD COLUMN "lease_token" UUID`,
    `ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6)`,
    `ADD COLUMN "claimed_at" TIMESTAMPTZ(6)`,
    `ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1`,
    `"status" = 'READY_TO_SUBMIT'`,
    `"status" = 'CLAIMED'`,
    `"lease_expires_at" <= "authorization_expires_at"`,
    `NEW."version" <> OLD."version" + 1`,
    `OLD."lease_expires_at" <= clock_timestamp()`,
    `NEW."lease_token" IS NOT DISTINCT FROM OLD."lease_token"`
  ]) {
    assert.ok(normalized.includes(required), `Missing ${required}`);
  }
  assert.ok(
    normalized.includes(
      `CREATE TRIGGER "rank_connector_execution_scope_guard" BEFORE INSERT OR DELETE ON "rank_connector_executions"`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE TRIGGER "rank_connector_execution_claim_transition_guard" BEFORE UPDATE ON "rank_connector_executions"`
    )
  );
});

test("uses a hardened SECURITY DEFINER function and canonical graph locks", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);

  assert.ok(
    normalized.includes(
      `CREATE FUNCTION "claim_rank_connector_execution"( p_lease_owner TEXT, p_lease_seconds INTEGER, p_execution_connector_version TEXT )`
    )
  );
  assert.ok(normalized.includes(`LANGUAGE plpgsql SECURITY DEFINER`));
  assert.ok(
    normalized.includes(`SET search_path = pg_catalog, pg_temp`)
  );
  assert.ok(normalized.includes(`FOR UPDATE OF job SKIP LOCKED`));

  const lockMarkers = [
    "rank-connector-claim:job",
    "rank-connector-claim:run",
    "rank-connector-claim:item",
    "rank-connector-claim:credential",
    "rank-connector-claim:validation",
    "rank-connector-claim:binding",
    "rank-connector-claim:route",
    "rank-connector-claim:grant",
    "rank-connector-claim:execution",
    "rank-connector-claim:control"
  ];
  let previous = -1;
  for (const marker of lockMarkers) {
    const current = sql.indexOf(marker);
    assert.ok(current > previous, `Invalid lock order at ${marker}`);
    previous = current;
  }

  for (const relation of [
    "public.rank_connector_executions",
    "public.jobs",
    "public.rank_job_runs",
    "public.job_items",
    "public.integration_credentials",
    "public.project_connector_bindings",
    "public.project_connector_routes",
    "public.rank_execution_grant_attempts",
    "public.rank_connector_execution_controls"
  ]) {
    assert.ok(sql.includes(relation), `Missing qualified ${relation}`);
  }
});

test("hardens the deferred consumed-graph trigger against caller search_path", async () => {
  const normalized = compactSql(await migration);

  assert.ok(
    normalized.includes(
      `CREATE OR REPLACE FUNCTION public.assert_rank_connector_execution_consumed_graph()`
    )
  );
  assert.ok(
    normalized.includes(
      `FROM public.rank_execution_grant_attempts attempt`
    )
  );
  assert.ok(
    normalized.includes(
      `FROM public.rank_connector_executions execution`
    )
  );
  assert.match(
    normalized,
    /assert_rank_connector_execution_consumed_graph\(\) RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp/u
  );
  assert.ok(
    normalized.includes(
      `REVOKE ALL ON FUNCTION "assert_rank_connector_execution_consumed_graph"() FROM PUBLIC;`
    )
  );
});

test("filters the full current graph before locking a parent Job", async () => {
  const sql = await migration;
  const start = sql.indexOf("rank-connector-claim:job");
  const end = sql.indexOf("rank-connector-claim:run", start);
  assert.ok(start >= 0 && end > start);
  const discovery = compactSql(sql.slice(start, end));

  for (const required of [
    `JOIN public.rank_job_runs run`,
    `JOIN public.job_items item`,
    `JOIN public.integration_credentials credential`,
    `JOIN public.jobs validation`,
    `JOIN public.project_connector_bindings binding`,
    `JOIN public.project_connector_routes route`,
    `JOIN public.rank_execution_grant_attempts grant_attempt`,
    `job."cancel_requested_at" IS NULL`,
    `run."seal_state" = 'SEALED'`,
    `item."status" = 'QUEUED'`,
    `credential."status" = 'ACTIVE'`,
    `validation."status" = 'COMPLETED'`,
    `binding."enabled"`,
    `grant_attempt."status" = 'CONSUMED'`,
    `FOR UPDATE OF job SKIP LOCKED`
  ]) {
    assert.ok(
      discovery.includes(required),
      `Candidate discovery can starve behind missing ${required}`
    );
  }
  assert.doesNotMatch(discovery, /FOR UPDATE OF (?!job\b)/u);
});

test("rechecks lifecycle, credential, grant, authorization and control after locks", async () => {
  const normalized = compactSql(await migration);

  for (const invariant of [
    `run."seal_state" = 'SEALED'`,
    `run."finalization_status" IS NULL`,
    `item."status" = 'QUEUED'`,
    `credential."status" = 'ACTIVE'`,
    `credential."deleted_at" IS NULL`,
    `validation."status" = 'COMPLETED'`,
    `validation."input_snapshot" = jsonb_build_object(`,
    `binding."capability" = 'SERP_RANK_TRACKING'`,
    `binding."enabled"`,
    `route."source_kind" = 'WORKSPACE_CREDENTIAL'`,
    `grant_attempt."status" = 'CONSUMED'`,
    `grant_attempt."expires_at" = candidate."authorization_expires_at"`,
    `IF NOT current_control."submit_enabled"`,
    `current_execution."authorization_expires_at" <= v_claimed_lease_expires_at`,
    `job."cancel_requested_at" IS NULL`
  ]) {
    assert.ok(normalized.includes(invariant), `Missing ${invariant}`);
  }
});

test("returns only one scoped encrypted credential projection and no provider action", async () => {
  const sql = await migration;
  const returnStart = sql.indexOf("RETURNS TABLE (");
  const returnEnd = sql.indexOf(")\nLANGUAGE plpgsql", returnStart);
  assert.ok(returnStart >= 0 && returnEnd > returnStart);
  const projection = sql.slice(returnStart, returnEnd);

  for (const field of [
    `"executionId" UUID`,
    `"leaseToken" UUID`,
    `"leaseExpiresAt" TIMESTAMPTZ`,
    `"workspaceId" UUID`,
    `"provider" VARCHAR(64)`,
    `"credentialId" UUID`,
    `"credentialMaterialVersion" INTEGER`,
    `"ciphertext" BYTEA`,
    `"nonce" BYTEA`,
    `"authTag" BYTEA`,
    `"encryptedDataKey" BYTEA`,
    `"dataKeyNonce" BYTEA`,
    `"dataKeyAuthTag" BYTEA`,
    `"keyVersion" INTEGER`
  ]) {
    assert.ok(projection.includes(field), `Missing projection ${field}`);
  }
  assert.doesNotMatch(
    projection,
    /label|displayHint|capabilities|providerMeta|idempotency|fingerprint|request|response|plaintext/iu
  );
  assert.doesNotMatch(sql, /\b(?:fetch|https?|set_positions)\b/iu);
  assert.ok(
    compactSql(sql).includes(
      `REVOKE ALL ON FUNCTION "claim_rank_connector_execution"(TEXT, INTEGER, TEXT) FROM PUBLIC;`
    )
  );
  assert.match(
    sql,
    /CLAIMED is intentionally pre-network[\s\S]*future authorize\/SUBMITTING/u
  );
});
