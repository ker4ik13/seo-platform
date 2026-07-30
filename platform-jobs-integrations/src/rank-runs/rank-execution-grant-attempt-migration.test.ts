import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260729230100_rank_execution_grant_attempts/migration.sql",
  import.meta.url
);

const migration = readFile(MIGRATION, "utf8");

function compactSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function sqlSection(sql: string, start: string, end: string): string {
  const startIndex = sql.indexOf(start);
  const endIndex = sql.indexOf(end, startIndex + start.length);

  assert.ok(startIndex >= 0, `Missing SQL section start: ${start}`);
  assert.ok(endIndex > startIndex, `Missing SQL section end: ${end}`);

  return sql.slice(startIndex, endIndex);
}

test("creates the grant attempt enum and table in one transaction", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);

  assert.match(sql, /^BEGIN;\s/u);
  assert.match(sql, /\sCOMMIT;\s*$/u);
  assert.ok(
    normalized.includes(
      `CREATE TYPE "RankExecutionGrantAttemptStatus" AS ENUM ( 'REQUESTED', 'DENIED', 'GRANTED_PENDING_CONSUME', 'EXPIRED', 'CONSUMED', 'REJECTED_LOCAL' );`
    )
  );
  assert.ok(
    normalized.includes(`CREATE TABLE "rank_execution_grant_attempts" (`)
  );
});

test("hardens legacy JobItems without a check-to-constraint writer window", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);
  const lockPosition = sql.indexOf(`LOCK TABLE "job_items"`);
  const preconditionPosition = sql.indexOf(
    `Repair JobItem tenant scope before rank grant attempt migration`
  );
  const foreignKeyPosition = sql.indexOf(
    `ADD CONSTRAINT "job_items_job_tenant_fkey"`
  );

  assert.ok(lockPosition >= 0);
  assert.ok(preconditionPosition > lockPosition);
  assert.ok(foreignKeyPosition > preconditionPosition);
  assert.ok(
    normalized.includes(
      `item."workspace_id" IS DISTINCT FROM job."workspace_id" OR item."project_id" IS DISTINCT FROM job."project_id"`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "jobs_tenant_id_key" ON "jobs" ("workspace_id", "id");`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "job_items_tenant_job_id_key" ON "job_items" ("workspace_id", "project_id", "job_id", "id");`
    )
  );
  assert.ok(
    normalized.includes(
      `CONSTRAINT "job_items_job_tenant_fkey" FOREIGN KEY ("workspace_id", "job_id") REFERENCES "jobs" ("workspace_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT`
    )
  );
  assert.ok(
    normalized.includes(
      `CONSTRAINT "job_items_job_tenant_project_fkey" FOREIGN KEY ("workspace_id", "project_id", "job_id") REFERENCES "jobs" ("workspace_id", "project_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT`
    )
  );
  const scopeGuard = sqlSection(
    sql,
    `CREATE FUNCTION "assert_job_item_tenant_scope"()`,
    `CREATE TRIGGER "job_item_tenant_scope_guard"`
  );
  assert.match(
    scopeGuard,
    /job\."project_id" IS NOT DISTINCT FROM NEW\."project_id"/u
  );
  assert.match(
    sql,
    /CREATE TRIGGER "job_item_tenant_scope_guard"[\s\S]*EXECUTE FUNCTION "assert_job_item_tenant_scope"\(\)/u
  );
});

test("persists exact intent and only 32-byte authorization hashes", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);
  const table = compactSql(
    sqlSection(
      sql,
      `CREATE TABLE "rank_execution_grant_attempts"`,
      `CREATE UNIQUE INDEX "rank_grant_attempts_workspace_item_attempt_key"`
    )
  );

  for (const column of [
    `"execution_attempt" INTEGER NOT NULL`,
    `"job_version" INTEGER NOT NULL`,
    `"idempotency_key" VARCHAR(180) NOT NULL`,
    `"request_snapshot" JSONB NOT NULL`,
    `"request_hash" BYTEA NOT NULL`,
    `"scope_hash" BYTEA NOT NULL`,
    `"execution_evidence_hash" BYTEA NOT NULL`,
    `"decision_snapshot" JSONB`,
    `"decided_at" TIMESTAMPTZ(6)`,
    `"expires_at" TIMESTAMPTZ(6)`,
    `"terminal_at" TIMESTAMPTZ(6)`
  ]) {
    assert.ok(table.includes(column), `Missing durable field: ${column}`);
  }

  assert.ok(
    normalized.includes(
      `octet_length("request_hash") = 32 AND octet_length("scope_hash") = 32 AND octet_length("execution_evidence_hash") = 32`
    )
  );
  assert.ok(
    normalized.includes(
      `"execution_attempt" BETWEEN 1 AND 1000 AND "job_version" > 0 AND "idempotency_key" ~ '^[A-Za-z0-9._:-]{16,180}$'`
    )
  );
  assert.ok(
    normalized.includes(
      `"idempotency_key" = 'rank-grant:' || "job_item_id"::text || ':' || "execution_attempt"::text`
    )
  );
  assert.doesNotMatch(
    table,
    /"(?:secret|ciphertext|nonce|auth_tag|encrypted_data_key|raw_payload|raw_response)"/u
  );
});

test("binds every attempt to the exact tenant Job graph", async () => {
  const sql = await migration;
  const normalized = compactSql(sql);

  assert.ok(
    normalized.includes(
      `CONSTRAINT "rank_grant_attempts_job_tenant_fkey" FOREIGN KEY ("workspace_id", "project_id", "job_id") REFERENCES "jobs" ("workspace_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT`
    )
  );
  assert.ok(
    normalized.includes(
      `CONSTRAINT "rank_grant_attempts_rank_run_tenant_fkey" FOREIGN KEY ("workspace_id", "project_id", "job_id") REFERENCES "rank_job_runs" ("workspace_id", "project_id", "job_id") ON DELETE RESTRICT ON UPDATE RESTRICT`
    )
  );
  assert.ok(
    normalized.includes(
      `CONSTRAINT "rank_grant_attempts_job_item_tenant_fkey" FOREIGN KEY ( "workspace_id", "project_id", "job_id", "job_item_id" ) REFERENCES "job_items" ( "workspace_id", "project_id", "job_id", "id" ) ON DELETE RESTRICT ON UPDATE RESTRICT`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "rank_grant_attempts_workspace_item_attempt_key" ON "rank_execution_grant_attempts" ( "workspace_id", "job_item_id", "execution_attempt" );`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "rank_grant_attempts_workspace_idempotency_key" ON "rank_execution_grant_attempts" ("workspace_id", "idempotency_key");`
    )
  );
});

test("rebuilds the request from an exact secret-free allowlist", async () => {
  const sql = await migration;
  const requestVerifier = compactSql(
    sqlSection(
      sql,
      `CREATE FUNCTION "rank_execution_grant_request_is_exact"(`,
      `CREATE FUNCTION "rank_execution_grant_decision_is_exact"(`
    )
  );

  for (const fixedValue of [
    `'schemaVersion', 'rank-execution-grant-request@1'`,
    `'purpose', 'PROVIDER_SUBMIT'`,
    `'provider', 'ARSENKIN'`,
    `'operation', 'POSITIONS'`,
    `'capability', 'SERP_RANK_TRACKING'`,
    `'credentialMode', 'BYOK_API_KEY'`,
    `'meter', 'RANK_PROVIDER_TASK'`,
    `'quantity', '1'`
  ]) {
    assert.ok(
      requestVerifier.includes(fixedValue),
      `Missing exact request value: ${fixedValue}`
    );
  }

  assert.ok(
    requestVerifier.includes(`'workspaceId', p_workspace_id::text`)
  );
  assert.ok(requestVerifier.includes(`'projectId', p_project_id::text`));
  assert.ok(requestVerifier.includes(`'jobId', p_job_id::text`));
  assert.ok(requestVerifier.includes(`'jobItemId', p_job_item_id::text`));
  assert.ok(requestVerifier.includes(`'jobVersion', p_job_version`));
  assert.ok(
    requestVerifier.includes(`'executionAttempt', p_execution_attempt`)
  );
  assert.ok(
    requestVerifier.includes(
      `'executionEvidenceHash', jsonb_build_object( 'algorithm', 'SHA_256', 'value', encode(p_execution_evidence_hash, 'hex') )`
    )
  );
  assert.ok(
    requestVerifier.includes(
      `'domainHash', jsonb_build_object( 'algorithm', 'SHA_256', 'value', p_snapshot #>> '{project,domainHash,value}' )`
    )
  );
  assert.ok(
    requestVerifier.includes(
      `'hash', jsonb_build_object( 'algorithm', 'SHA_256', 'value', p_snapshot #>> '{manifest,hash,value}' )`
    )
  );
  assert.ok(requestVerifier.includes(`octet_length(p_snapshot::text) > 32768`));
});

test("stores only exact denied or exact 30-second granted decisions", async () => {
  const sql = await migration;
  const decisionVerifier = compactSql(
    sqlSection(
      sql,
      `CREATE FUNCTION "rank_execution_grant_decision_is_exact"(`,
      `CREATE TABLE "rank_execution_grant_attempts"`
    )
  );

  assert.ok(
    decisionVerifier.includes(
      `'requestHash', jsonb_build_object( 'algorithm', 'SHA_256', 'value', encode(p_request_hash, 'hex') )`
    )
  );
  assert.ok(
    decisionVerifier.includes(
      `'scopeHash', jsonb_build_object( 'algorithm', 'SHA_256', 'value', encode(p_scope_hash, 'hex') )`
    )
  );
  assert.ok(decisionVerifier.includes(`'issuer', 'PLATFORM_API'`));
  assert.ok(
    decisionVerifier.includes(
      `issued_at_text = decided_at_text AND expires_at_text ~`
    )
  );
  assert.ok(
    decisionVerifier.includes(
      `p_expires_at = p_decided_at + INTERVAL '30 seconds'`
    )
  );
  assert.ok(decisionVerifier.includes(`'QUOTA_EXHAUSTED'`));
  assert.ok(decisionVerifier.includes(`octet_length(p_decision::text) > 32768`));
});

test("enforces the complete request, granted-pending and terminal state matrix", async () => {
  const sql = await migration;
  const stateMatrix = compactSql(
    sqlSection(
      sql,
      `CONSTRAINT "rank_grant_attempts_state_matrix"`,
      `CREATE UNIQUE INDEX "rank_grant_attempts_workspace_item_attempt_key"`
    )
  );

  assert.ok(
    stateMatrix.includes(
      `"status" = 'REQUESTED' AND "decision_snapshot" IS NULL AND "decided_at" IS NULL AND "expires_at" IS NULL AND "terminal_at" IS NULL`
    )
  );
  assert.match(
    stateMatrix,
    /"status" = 'DENIED'[\s\S]*'DENIED'[\s\S]*"terminal_at" IS NOT NULL/u
  );
  assert.match(
    stateMatrix,
    /"status" = 'GRANTED_PENDING_CONSUME'[\s\S]*'GRANTED'[\s\S]*"terminal_at" IS NULL/u
  );
  assert.ok(
    stateMatrix.includes(
      `"status" = 'CONSUMED' AND "rank_execution_grant_decision_is_exact"(`
    )
  );
  assert.ok(stateMatrix.includes(`"terminal_at" < "expires_at"`));
  assert.doesNotMatch(stateMatrix, /"terminal_at" <= "expires_at"/u);
  assert.ok(
    stateMatrix.includes(
      `"status" = 'EXPIRED' AND "rank_execution_grant_decision_is_exact"(`
    )
  );
  assert.ok(stateMatrix.includes(`"terminal_at" >= "expires_at"`));
  assert.ok(stateMatrix.includes(`"terminal_at" >= "created_at"`));
  assert.match(
    stateMatrix,
    /"status" = 'REJECTED_LOCAL'[\s\S]*"decision_snapshot" IS NULL[\s\S]*'GRANTED'/u
  );
});

test("guards legal transitions and freezes request and decision identity", async () => {
  const sql = await migration;
  const protection = compactSql(
    sqlSection(
      sql,
      `CREATE FUNCTION "protect_rank_execution_grant_attempt"()`,
      `CREATE TRIGGER "rank_execution_grant_attempt_protection"`
    )
  );

  assert.ok(
    protection.includes(
      `NEW."status" <> 'REQUESTED' OR NEW."decision_snapshot" IS NOT NULL OR NEW."decided_at" IS NOT NULL OR NEW."expires_at" IS NOT NULL OR NEW."terminal_at" IS NOT NULL`
    )
  );
  assert.ok(
    protection.includes(
      `OLD."status" = 'REQUESTED' AND NEW."status" IN ( 'DENIED', 'GRANTED_PENDING_CONSUME', 'EXPIRED', 'REJECTED_LOCAL' )`
    )
  );
  assert.ok(
    protection.includes(
      `OLD."status" = 'GRANTED_PENDING_CONSUME' AND NEW."status" IN ('CONSUMED', 'EXPIRED', 'REJECTED_LOCAL')`
    )
  );
  assert.ok(
    protection.includes(
      `NEW."request_snapshot" IS DISTINCT FROM OLD."request_snapshot" OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash" OR NEW."scope_hash" IS DISTINCT FROM OLD."scope_hash"`
    )
  );
  assert.ok(
    protection.includes(
      `NEW."decision_snapshot" IS DISTINCT FROM OLD."decision_snapshot" OR NEW."decided_at" IS DISTINCT FROM OLD."decided_at" OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"`
    )
  );
  assert.ok(
    protection.includes(
      `OLD."status" IN ( 'DENIED', 'EXPIRED', 'CONSUMED', 'REJECTED_LOCAL' )`
    )
  );
  assert.ok(
    protection.includes(
      `prior."execution_attempt" = NEW."execution_attempt" - 1 AND prior."status" = 'EXPIRED'`
    )
  );
  assert.match(
    sql,
    /CREATE TRIGGER "rank_execution_grant_attempt_protection"\s+BEFORE INSERT OR UPDATE OR DELETE ON "rank_execution_grant_attempts"/u
  );
  assert.match(
    sql,
    /CREATE TRIGGER "rank_execution_grant_attempt_no_truncate"\s+BEFORE TRUNCATE ON "rank_execution_grant_attempts"/u
  );
});
