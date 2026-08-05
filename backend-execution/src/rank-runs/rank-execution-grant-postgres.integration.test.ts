import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.JOBS_RANK_TEST_DATABASE_URL;
const HASH = {
  request: "11".repeat(32),
  scope: "22".repeat(32),
  evidence: "33".repeat(32),
  domain: "44".repeat(32),
  manifest: "55".repeat(32),
  manifestDeduplication: "66".repeat(32),
  estimateExecution: "77".repeat(32)
} as const;

test(
  "PostgreSQL 18 rejects out-of-manifest, expired, tenant and item-state executions",
  { skip: databaseUrl === undefined, timeout: 20_000 },
  async () => {
    assert.ok(databaseUrl);
    const client = await connectedClient(databaseUrl);

    try {
      await assertPostgres18(client);

      const outOfManifest = await createExecutionGraph(client, {
        itemSequence: 1,
        manifestChunkCount: 1
      });
      await createGrantedAttempt(client, outOfManifest, 20_000);
      await assert.rejects(
        insertConnectorExecution(client, outOfManifest),
        hasSqlState("23514")
      );

      const expired = await createExecutionGraph(client);
      await createGrantedAttempt(client, expired, 200);
      await delay(350);
      await assert.rejects(
        insertConnectorExecution(client, expired),
        hasSqlState("23514")
      );
      assert.equal(await executionCount(client, expired), 0);

      const tenantMismatch = await createExecutionGraph(client);
      await createGrantedAttempt(client, tenantMismatch, 20_000);
      await assert.rejects(
        insertConnectorExecution(client, tenantMismatch, {
          workspaceId: await databaseUuidV7(client)
        }),
        hasSqlState("23514")
      );

      const itemStateMismatch = await createExecutionGraph(client);
      await createGrantedAttempt(client, itemStateMismatch, 20_000);
      await client.query(
        `UPDATE job_items
         SET status = 'RUNNING', updated_at = clock_timestamp()
         WHERE id = $1::uuid`,
        [itemStateMismatch.jobItemId]
      );
      await assert.rejects(
        insertConnectorExecution(client, itemStateMismatch),
        hasSqlState("23514")
      );
    } finally {
      await client.end();
    }
  }
);

test(
  "PostgreSQL 18 defers and rejects both halves of a consumed grant graph",
  { skip: databaseUrl === undefined, timeout: 20_000 },
  async () => {
    assert.ok(databaseUrl);
    const client = await connectedClient(databaseUrl);

    try {
      await assertPostgres18(client);

      const consumedWithoutExecution = await createExecutionGraph(client);
      await createGrantedAttempt(
        client,
        consumedWithoutExecution,
        20_000
      );
      await client.query("BEGIN");
      await markConsumed(client, consumedWithoutExecution);
      await assert.rejects(client.query("COMMIT"), hasSqlState("23514"));
      assert.equal(
        await attemptStatus(client, consumedWithoutExecution),
        "GRANTED_PENDING_CONSUME"
      );

      const executionWithoutConsumed = await createExecutionGraph(client);
      await createGrantedAttempt(
        client,
        executionWithoutConsumed,
        20_000
      );
      await client.query("BEGIN");
      await insertConnectorExecution(client, executionWithoutConsumed);
      await assert.rejects(client.query("COMMIT"), hasSqlState("23514"));
      assert.equal(
        await attemptStatus(client, executionWithoutConsumed),
        "GRANTED_PENDING_CONSUME"
      );
      assert.equal(await executionCount(client, executionWithoutConsumed), 0);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  }
);

test(
  "two concurrent consumers commit one execution and one CONSUMED transition",
  { skip: databaseUrl === undefined, timeout: 20_000 },
  async () => {
    assert.ok(databaseUrl);
    const setup = await connectedClient(databaseUrl);
    const first = await connectedClient(databaseUrl);
    const second = await connectedClient(databaseUrl);

    try {
      await assertPostgres18(setup);
      const fixture = await createExecutionGraph(setup);
      await createGrantedAttempt(setup, fixture, 20_000);

      const results = await Promise.all([
        consumeIfPending(first, fixture),
        consumeIfPending(second, fixture)
      ]);

      assert.deepEqual(results.sort(), [false, true]);
      assert.equal(await attemptStatus(setup, fixture), "CONSUMED");
      assert.equal(await executionCount(setup, fixture), 1);
    } finally {
      await Promise.allSettled([setup.end(), first.end(), second.end()]);
    }
  }
);

interface ExecutionFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly membershipId: string;
  readonly estimateId: string;
  readonly validationJobId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly manifestId: string;
  readonly bindingId: string;
  readonly routeId: string;
  readonly credentialId: string;
  readonly grantAttemptId: string;
  readonly grantId: string;
  readonly itemSequence: number;
  readonly verifiedAt: Date;
  readonly authorizationExpiresAt: Date;
}

interface GraphOptions {
  readonly itemSequence?: number;
  readonly manifestChunkCount?: number;
}

async function createExecutionGraph(
  client: Client,
  options: GraphOptions = {}
): Promise<ExecutionFixture> {
  const itemSequence = options.itemSequence ?? 0;
  const manifestChunkCount = options.manifestChunkCount ?? 1;
  const ids = await databaseUuidV7s(client, 13);
  const [
    workspaceId,
    projectId,
    actorId,
    membershipId,
    estimateId,
    validationJobId,
    jobId,
    jobItemId,
    manifestId,
    bindingId,
    routeId,
    credentialId,
    grantAttemptId
  ] = ids;
  assert.ok(
    workspaceId &&
      projectId &&
      actorId &&
      membershipId &&
      estimateId &&
      validationJobId &&
      jobId &&
      jobItemId &&
      manifestId &&
      bindingId &&
      routeId &&
      credentialId &&
      grantAttemptId
  );
  const grantId = await databaseUuidV7(client);
  const trackingContextId = await databaseUuidV7(client);
  const verifiedAt = new Date();

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO jobs (
         id, workspace_id, project_id, type, status, stage,
         idempotency_scope, input_snapshot, scope_snapshot,
         credential_mode, provider, correlation_id, version,
         finished_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid,
         'INTEGRATION_CREDENTIAL_VALIDATE', 'COMPLETED', 'FINISHED',
         $4, '{}'::jsonb, '{}'::jsonb, 'BYOK_API_KEY', 'ARSENKIN',
         'rank-grant-postgres-validation', 1, $5::timestamptz,
         clock_timestamp()
       )`,
      [
        validationJobId,
        workspaceId,
        projectId,
        `rank-grant-validation:${validationJobId}`,
        verifiedAt
      ]
    );
    await client.query(
      `INSERT INTO integration_credentials (
         id, workspace_id, provider, label, mode, status, ciphertext,
         nonce, auth_tag, encrypted_data_key, data_key_nonce,
         data_key_auth_tag, key_version, capabilities, idempotency_key,
         request_fingerprint, fingerprint_key_version, material_version,
         verified_at, version, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, 'ARSENKIN', 'PostgreSQL grant fixture',
         'BYOK_API_KEY', 'ACTIVE', decode('01', 'hex'),
         decode(repeat('02', 12), 'hex'),
         decode(repeat('03', 16), 'hex'), decode('04', 'hex'),
         decode(repeat('05', 12), 'hex'),
         decode(repeat('06', 16), 'hex'), 1, '{}'::jsonb, $3,
         decode(repeat('07', 32), 'hex'), 1, 1, $4::timestamptz, 1,
         clock_timestamp()
       )`,
      [
        credentialId,
        workspaceId,
        `rank-grant-credential:${credentialId}`,
        verifiedAt
      ]
    );
    await client.query(
      `INSERT INTO project_connector_bindings (
         id, workspace_id, project_id, capability, enabled,
         created_by, updated_by, version, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'SERP_RANK_TRACKING', TRUE,
         $4::uuid, $4::uuid, 1, clock_timestamp()
       )`,
      [bindingId, workspaceId, projectId, actorId]
    );
    await client.query(
      `INSERT INTO project_connector_routes (
         id, workspace_id, project_id, binding_id, position,
         source_kind, credential_id, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, 0,
         'WORKSPACE_CREDENTIAL', $5::uuid, clock_timestamp()
       )`,
      [routeId, workspaceId, projectId, bindingId, credentialId]
    );
    await client.query(
      `INSERT INTO rank_estimates (
         id, workspace_id, project_id, actor_id, tracking_context_id,
         idempotency_scope, idempotency_key, request_hash,
         project_version, project_domain_hash, context_version,
         configuration_version, configuration_hash, semantic_scope_hash,
         scope_hash, binding_id, binding_version, route_id, credential_id,
         credential_status, credential_version,
         credential_material_version, credential_validation_id,
         credential_validation_version,
         credential_validation_connector_version,
         credential_validation_finished_at, credential_verified_at,
         provider, credential_mode, provider_policy_version, keyword_count,
         provider_task_count, minimum_submit_request_count,
         minimum_check_request_count, minimum_get_request_count, blockers,
         response_snapshot, execution_snapshot, execution_snapshot_hash,
         calculated_at, expires_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7,
         decode($8, 'hex'), 1, decode($9, 'hex'), 1, 1,
         decode(repeat('08', 32), 'hex'), decode(repeat('09', 32), 'hex'),
         decode(repeat('0a', 32), 'hex'), $10::uuid, 1, $11::uuid,
         $12::uuid, 'ACTIVE', 1, 1, $13::uuid, 1, 'arsenkin@1',
         $14::timestamptz, $14::timestamptz, 'ARSENKIN', 'BYOK_API_KEY',
         'arsenkin-positions@1', 1, 1, 1, 1, 1, '[]'::jsonb, '{}'::jsonb,
         '{}'::jsonb, decode($15, 'hex'), $16::timestamptz,
         $16::timestamptz + INTERVAL '5 minutes'
       )`,
      [
        estimateId,
        workspaceId,
        projectId,
        actorId,
        trackingContextId,
        `rank-grant-estimate:${projectId}`,
        `rank-grant-estimate:${estimateId}`,
        HASH.request,
        HASH.domain,
        bindingId,
        routeId,
        credentialId,
        validationJobId,
        verifiedAt,
        HASH.estimateExecution,
        verifiedAt
      ]
    );
    await client.query(
      `INSERT INTO jobs (
         id, workspace_id, project_id, type, status, stage, actor_id,
         deduplication_key, idempotency_scope, idempotency_key,
         request_hash, input_snapshot, scope_snapshot, progress_current,
         progress_total, progress_unit, estimated_cost_micro, currency,
         credential_mode, provider, max_attempts, correlation_id, version,
         updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'MANUAL_RANK_CHECK', 'PREPARING',
         'PREPARING_SCOPE', $4::uuid, $5, $6, $7, decode($8, 'hex'),
         '{}'::jsonb, '{}'::jsonb, 0, 1, 'KEYWORD', 0, 'RUB',
         'BYOK_API_KEY', 'ARSENKIN', 20, 'rank-grant-postgres', 1,
         clock_timestamp()
       )`,
      [
        jobId,
        workspaceId,
        projectId,
        actorId,
        `rank-grant-dedup:${jobId}`,
        `rank-run:${projectId}`,
        `rank-run:${jobId}`,
        HASH.request
      ]
    );
    await client.query(
      `INSERT INTO rank_job_runs (
         job_id, workspace_id, project_id, estimate_id,
         tracking_context_id, project_domain, project_status,
         project_version, manifest_command, manifest_command_hash,
         updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
         'example.test', 'ACTIVE', 1, '{}'::jsonb,
         decode(repeat('0b', 32), 'hex'), clock_timestamp()
       )`,
      [jobId, workspaceId, projectId, estimateId, trackingContextId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  await client.query("BEGIN");
  try {
    await client.query(
      `UPDATE rank_job_runs
       SET seal_state = 'OUTCOME_UNKNOWN', seal_attempt_count = 1,
           last_seal_attempt_at = clock_timestamp(),
           updated_at = clock_timestamp()
       WHERE job_id = $1::uuid`,
      [jobId]
    );
    await client.query(
      `UPDATE jobs
       SET status = 'QUEUED', stage = 'WAITING_FOR_QUEUE',
           queued_at = clock_timestamp(), attempt = 1,
           version = version + 1,
           updated_at = clock_timestamp()
       WHERE id = $1::uuid`,
      [jobId]
    );
    await client.query(
      `UPDATE rank_job_runs
       SET seal_state = 'SEALED', manifest_id = $2::uuid,
           manifest_hash_schema = 'rank-manifest@1',
           manifest_hash = decode($3, 'hex'),
           manifest_deduplication_hash = decode($4, 'hex'),
           manifest_pair_count = $5, manifest_chunk_count = $6,
           manifest_chunk_size = 250, manifest_sealed_at = clock_timestamp(),
           updated_at = clock_timestamp()
       WHERE job_id = $1::uuid`,
      [
        jobId,
        manifestId,
        HASH.manifest,
        HASH.manifestDeduplication,
        manifestChunkCount * 250 - 249,
        manifestChunkCount
      ]
    );
    await client.query(
      `INSERT INTO job_items (
         id, workspace_id, project_id, job_id, sequence, status,
         input_reference, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'QUEUED',
         jsonb_build_object(
           'schemaVersion', 'rank-job-item@1',
           'manifestId', $6::uuid::text,
           'chunkIndex', $5::integer
         ),
         clock_timestamp()
       )`,
      [jobItemId, workspaceId, projectId, jobId, itemSequence, manifestId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  return {
    workspaceId,
    projectId,
    actorId,
    membershipId,
    estimateId,
    validationJobId,
    jobId,
    jobItemId,
    manifestId,
    bindingId,
    routeId,
    credentialId,
    grantAttemptId,
    grantId,
    itemSequence,
    verifiedAt,
    authorizationExpiresAt: new Date(0)
  };
}

async function createGrantedAttempt(
  client: Client,
  fixture: ExecutionFixture,
  expiresInMs: number
): Promise<void> {
  const decidedAt = new Date(Date.now() - (30_000 - expiresInMs));
  const authorizationExpiresAt = new Date(decidedAt.getTime() + 30_000);
  Object.assign(fixture, { authorizationExpiresAt });
  const requestSnapshot = {
    schemaVersion: "rank-execution-grant-request@1",
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    actorId: fixture.actorId,
    membership: { id: fixture.membershipId, version: 1 },
    project: {
      version: 1,
      domainHash: { algorithm: "SHA_256", value: HASH.domain }
    },
    jobId: fixture.jobId,
    jobItemId: fixture.jobItemId,
    jobVersion: 2,
    executionAttempt: 1,
    purpose: "PROVIDER_SUBMIT",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    capability: "SERP_RANK_TRACKING",
    credentialMode: "BYOK_API_KEY",
    manifest: {
      id: fixture.manifestId,
      hash: { algorithm: "SHA_256", value: HASH.manifest },
      chunkIndex: fixture.itemSequence
    },
    executionEvidenceHash: {
      algorithm: "SHA_256",
      value: HASH.evidence
    },
    policyVersion: "manual-arsenkin-positions@1.0.0",
    usageIntent: { meter: "RANK_PROVIDER_TASK", quantity: "1" }
  };
  const decisionSnapshot = {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "GRANTED",
    requestHash: { algorithm: "SHA_256", value: HASH.request },
    decidedAt: decidedAt.toISOString(),
    grant: {
      schemaVersion: "rank-execution-grant@1",
      id: fixture.grantId,
      requestHash: { algorithm: "SHA_256", value: HASH.request },
      scopeHash: { algorithm: "SHA_256", value: HASH.scope },
      issuer: "PLATFORM_API",
      issuedAt: decidedAt.toISOString(),
      expiresAt: authorizationExpiresAt.toISOString()
    }
  };

  await client.query(
    `INSERT INTO rank_execution_grant_attempts (
       id, workspace_id, project_id, job_id, job_item_id,
       execution_attempt, job_version, idempotency_key, request_snapshot,
       request_hash, scope_hash, execution_evidence_hash, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, 2,
       'rank-grant:' || $5::uuid::text || ':1', $6::jsonb,
       decode($7, 'hex'), decode($8, 'hex'), decode($9, 'hex'),
       clock_timestamp()
     )`,
    [
      fixture.grantAttemptId,
      fixture.workspaceId,
      fixture.projectId,
      fixture.jobId,
      fixture.jobItemId,
      JSON.stringify(requestSnapshot),
      HASH.request,
      HASH.scope,
      HASH.evidence
    ]
  );
  await client.query(
    `UPDATE rank_execution_grant_attempts
     SET status = 'GRANTED_PENDING_CONSUME',
         decision_snapshot = $2::jsonb,
         decided_at = $3::timestamptz,
         expires_at = $4::timestamptz,
         updated_at = clock_timestamp()
     WHERE id = $1::uuid`,
    [
      fixture.grantAttemptId,
      JSON.stringify(decisionSnapshot),
      decidedAt,
      authorizationExpiresAt
    ]
  );
}

async function insertConnectorExecution(
  client: Client,
  fixture: ExecutionFixture,
  overrides: { readonly workspaceId?: string } = {}
): Promise<void> {
  await client.query(
    `INSERT INTO rank_connector_executions (
       workspace_id, project_id, job_id, job_item_id, grant_attempt_id,
       execution_attempt, job_version, estimate_id, manifest_id,
       manifest_hash, manifest_chunk_index, binding_id, binding_version,
       route_id, credential_id, credential_version,
       credential_material_version, credential_validation_id,
       credential_validation_version,
       credential_validation_connector_version, credential_verified_at,
       estimate_execution_hash, execution_evidence_hash,
       execution_connector_version, provider_policy_version,
       kill_switch_version, authorization_expires_at, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, 2,
       $6::uuid, $7::uuid, decode($8, 'hex'), $9, $10::uuid, 1,
       $11::uuid, $12::uuid, 1, 1, $13::uuid, 1, 'arsenkin@1',
       $14::timestamptz, decode($15, 'hex'), decode($16, 'hex'),
       'arsenkin@1', 'arsenkin-positions@1', 'rank-submit-disabled@1',
       $17::timestamptz, clock_timestamp()
     )`,
    [
      overrides.workspaceId ?? fixture.workspaceId,
      fixture.projectId,
      fixture.jobId,
      fixture.jobItemId,
      fixture.grantAttemptId,
      fixture.estimateId,
      fixture.manifestId,
      HASH.manifest,
      fixture.itemSequence,
      fixture.bindingId,
      fixture.routeId,
      fixture.credentialId,
      fixture.validationJobId,
      fixture.verifiedAt,
      HASH.estimateExecution,
      HASH.evidence,
      fixture.authorizationExpiresAt
    ]
  );
}

async function markConsumed(
  client: Client,
  fixture: ExecutionFixture
): Promise<void> {
  await client.query(
    `UPDATE rank_execution_grant_attempts
     SET status = 'CONSUMED', terminal_at = clock_timestamp(),
         updated_at = clock_timestamp()
     WHERE id = $1::uuid`,
    [fixture.grantAttemptId]
  );
}

async function consumeIfPending(
  client: Client,
  fixture: ExecutionFixture
): Promise<boolean> {
  await client.query("BEGIN");
  try {
    const locked = await client.query<{ readonly status: string }>(
      `SELECT status::text
       FROM rank_execution_grant_attempts
       WHERE id = $1::uuid
       FOR UPDATE`,
      [fixture.grantAttemptId]
    );
    if (locked.rows[0]?.status !== "GRANTED_PENDING_CONSUME") {
      await client.query("COMMIT");
      return false;
    }
    await insertConnectorExecution(client, fixture);
    await markConsumed(client, fixture);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function attemptStatus(
  client: Client,
  fixture: ExecutionFixture
): Promise<string | undefined> {
  const result = await client.query<{ readonly status: string }>(
    `SELECT status::text
     FROM rank_execution_grant_attempts
     WHERE id = $1::uuid`,
    [fixture.grantAttemptId]
  );
  return result.rows[0]?.status;
}

async function executionCount(
  client: Client,
  fixture: ExecutionFixture
): Promise<number> {
  const result = await client.query<{ readonly count: string }>(
    `SELECT count(*)::text AS count
     FROM rank_connector_executions
     WHERE grant_attempt_id = $1::uuid`,
    [fixture.grantAttemptId]
  );
  return Number(result.rows[0]?.count);
}

async function assertPostgres18(client: Client): Promise<void> {
  const result = await client.query<{
    readonly server_version_num: string;
  }>("SHOW server_version_num");
  assert.ok(
    Number(result.rows[0]?.server_version_num) >= 180_000,
    "PostgreSQL 18 or newer is required"
  );
}

async function connectedClient(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function databaseUuidV7(client: Client): Promise<string> {
  const result = await client.query<{ readonly id: string }>(
    "SELECT uuidv7()::text AS id"
  );
  const id = result.rows[0]?.id;
  assert.ok(id);
  return id;
}

async function databaseUuidV7s(
  client: Client,
  count: number
): Promise<readonly string[]> {
  const result = await client.query<{ readonly id: string }>(
    `SELECT uuidv7()::text AS id
     FROM generate_series(1, $1::integer)`,
    [count]
  );
  return result.rows.map((row) => row.id);
}

function hasSqlState(expected: string): (error: unknown) => boolean {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === expected;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
