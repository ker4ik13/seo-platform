import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260729230200_rank_connector_executions/migration.sql",
  import.meta.url
);

const migration = readFile(MIGRATION, "utf8");
const newerValidationMigration = readFile(
  new URL(
    "../../prisma/migrations/20260805170000_rank_execution_newer_validation/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const validationTimestampPrecisionMigration = readFile(
  new URL(
    "../../prisma/migrations/20260805201500_rank_validation_timestamp_precision/migration.sql",
    import.meta.url
  ),
  "utf8"
);

function compactSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

test("creates a secret-free scoped connector execution in one transaction", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);

  assert.match(sql, /^BEGIN;\s/u);
  assert.match(sql, /\sCOMMIT;\s*$/u);
  assert.ok(
    normalized.includes(
      `CREATE TYPE "RankConnectorExecutionStatus" AS ENUM ( 'READY_TO_SUBMIT' );`
    )
  );
  assert.ok(
    normalized.includes(`CREATE TABLE "rank_connector_executions" (`)
  );
  for (const required of [
    `"grant_attempt_id" UUID NOT NULL`,
    `"execution_evidence_hash" BYTEA NOT NULL`,
    `"credential_material_version" INTEGER NOT NULL`,
    `"authorization_expires_at" TIMESTAMPTZ(6) NOT NULL`,
    `"status" "RankConnectorExecutionStatus" NOT NULL DEFAULT 'READY_TO_SUBMIT'`
  ]) {
    assert.ok(normalized.includes(required), `Missing ${required}`);
  }
  assert.doesNotMatch(
    sql,
    /"(?:secret|ciphertext|nonce|auth_tag|encrypted_data_key|raw_payload|raw_response)"/u
  );
});

test("binds the execution to tenant Job, item, grant and credential graphs", async () => {
  const normalized = compactSql(await migration);

  for (const constraint of [
    `"rank_connector_executions_job_tenant_fkey"`,
    `"rank_connector_executions_rank_run_tenant_fkey"`,
    `"rank_connector_executions_job_item_tenant_fkey"`,
    `"rank_connector_executions_grant_attempt_fkey"`,
    `"rank_connector_executions_binding_tenant_fkey"`,
    `"rank_connector_executions_route_fkey"`,
    `"rank_connector_executions_credential_tenant_fkey"`,
    `"rank_connector_executions_validation_job_tenant_fkey"`
  ]) {
    assert.ok(
      normalized.includes(`CONSTRAINT ${constraint}`),
      `Missing ${constraint}`
    );
  }
  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "rank_connector_executions_grant_attempt_key" ON "rank_connector_executions" ("grant_attempt_id");`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "rank_connector_executions_workspace_item_attempt_key" ON "rank_connector_executions" ( "workspace_id", "job_item_id", "execution_attempt" );`
    )
  );
});

test("requires a current unexpired granted execution graph before insert", async () => {
  const normalized = compactSql(await migration);

  for (const invariant of [
    `attempt."status" = 'GRANTED_PENDING_CONSUME'`,
    `attempt."expires_at" > clock_timestamp()`,
    `job."cancel_requested_at" IS NULL`,
    `run."seal_state" = 'SEALED'`,
    `NEW."manifest_chunk_index" < run."manifest_chunk_count"`,
    `item."status" = 'QUEUED'`,
    `credential."status" = 'ACTIVE'`,
    `credential."deleted_at" IS NULL`,
    `validation."status" = 'COMPLETED'`,
    `binding."capability" = 'SERP_RANK_TRACKING'`,
    `binding."enabled"`,
    `route."source_kind" = 'WORKSPACE_CREDENTIAL'`
  ]) {
    assert.ok(
      normalized.includes(invariant),
      `Missing execution invariant: ${invariant}`
    );
  }
  assert.match(
    normalized,
    /CREATE TRIGGER "rank_connector_execution_scope_guard" BEFORE INSERT OR UPDATE OR DELETE/u
  );
});

test("defers the exact one-to-one CONSUMED graph until transaction commit", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);

  assert.ok(
    normalized.includes(
      `attempt."status" = 'CONSUMED' AND ( SELECT count(*) FROM "rank_connector_executions" execution WHERE execution."grant_attempt_id" = attempt."id" ) <> 1`
    )
  );
  assert.ok(
    normalized.includes(
      `attempt."status" <> 'CONSUMED' AND EXISTS ( SELECT 1 FROM "rank_connector_executions" execution WHERE execution."grant_attempt_id" = attempt."id" )`
    )
  );
  assert.match(
    normalized,
    /CREATE CONSTRAINT TRIGGER "rank_connector_execution_consumed_attempt_guard" AFTER INSERT OR UPDATE OR DELETE ON "rank_connector_executions" DEFERRABLE INITIALLY DEFERRED/u
  );
  assert.match(
    normalized,
    /CREATE CONSTRAINT TRIGGER "rank_grant_attempt_connector_execution_guard" AFTER INSERT OR UPDATE OR DELETE ON "rank_execution_grant_attempts" DEFERRABLE INITIALLY DEFERRED/u
  );
  assert.match(
    normalized,
    /CREATE TRIGGER "rank_connector_execution_no_truncate" BEFORE TRUNCATE/u
  );
  assert.ok(
    normalized.includes(
      `IF TG_TABLE_NAME = 'rank_connector_executions' THEN IF TG_OP = 'DELETE' THEN attempt_id := OLD."grant_attempt_id"; ELSE attempt_id := NEW."grant_attempt_id"; END IF; ELSE IF TG_OP = 'DELETE' THEN attempt_id := OLD."id"; ELSE attempt_id := NEW."id"; END IF; END IF;`
    )
  );
  assert.doesNotMatch(
    sql,
    /attempt_id\s*:=\s*CASE[\s\S]*NEW\."grant_attempt_id"[\s\S]*NEW\."id"/u
  );
});

test("binds a refreshed rank credential proof to unchanged secret material", async () => {
  const normalized = compactSql(await newerValidationMigration);

  for (const invariant of [
    `estimate.credential_version <= NEW.credential_version`,
    `estimate.credential_material_version = NEW.credential_material_version`,
    `credential.version = NEW.credential_version`,
    `credential.material_version = NEW.credential_material_version`,
    `credential.verified_at = NEW.credential_verified_at`,
    `validation.finished_at = NEW.credential_verified_at`,
    `validation.finished_at >= clock_timestamp() - INTERVAL '24 hours'`,
    `'credentialId', NEW.credential_id::text`,
    `'credentialMaterialVersion', NEW.credential_material_version`,
    `'connectorVersion', NEW.credential_validation_connector_version`,
    `route.retired_at IS NULL`
  ]) {
    assert.ok(
      normalized.includes(invariant),
      `Missing refreshed credential invariant: ${invariant}`
    );
  }
  assert.doesNotMatch(
    normalized,
    /estimate\.credential_validation_id = NEW\.credential_validation_id/u
  );
});

test("compares validation proof timestamps at the JavaScript millisecond boundary", async () => {
  const sql = await validationTimestampPrecisionMigration;
  const normalized = compactSql(sql);

  assert.match(sql, /^BEGIN;\s/u);
  assert.match(sql, /\sCOMMIT;\s*$/u);
  assert.ok(
    normalized.includes(
      `date_trunc('milliseconds', validation.finished_at) = NEW.credential_verified_at`
    )
  );
  assert.ok(
    normalized.includes(
      `credential.verified_at = NEW.credential_verified_at`
    )
  );
  assert.doesNotMatch(
    normalized,
    /\bvalidation\.finished_at = NEW\.credential_verified_at\b/u
  );
});
