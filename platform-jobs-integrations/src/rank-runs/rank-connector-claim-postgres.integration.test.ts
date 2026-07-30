import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.JOBS_RANK_TEST_DATABASE_URL;
const CONNECTOR_VERSION = "arsenkin-positions@1.0.0";
const POLICY_VERSION = "manual-arsenkin-positions@1.0.0";
const VALIDATION_CONNECTOR_VERSION = "arsenkin@1.0.0";
const HASH = {
  request: "81".repeat(32),
  scope: "82".repeat(32),
  evidence: "83".repeat(32),
  domain: "84".repeat(32),
  manifest: "85".repeat(32),
  manifestDeduplication: "86".repeat(32),
  estimateExecution: "87".repeat(32)
} as const;

test(
  "PostgreSQL 18 scopes concurrent claims, skips stale heads and rechecks lease/control drift",
  { skip: databaseUrl === undefined, timeout: 30_000 },
  async () => {
    assert.ok(databaseUrl);
    const setup = await connectedClient(databaseUrl);
    const first = await connectedClient(databaseUrl);
    const second = await connectedClient(databaseUrl);
    const attacker = await connectedClient(databaseUrl);
    const suffix = Date.now().toString(36);
    const enabledKillSwitchVersion = `claim-enabled@${suffix}`;
    const disabledKillSwitchVersion = `claim-disabled@${suffix}`;
    const shadowKillSwitchVersion = `claim-shadow@${suffix}`;
    const cleanupKillSwitchVersion = `claim-cleanup@${suffix}`;
    const restrictedRoleName = `rank_claim_${suffix}`;
    let restrictedRoleCreated = false;

    try {
      await assertPostgres18(setup);
      const control = await setup.query<{
        readonly submitEnabled: boolean;
      }>(
        `SELECT submit_enabled AS "submitEnabled"
         FROM rank_connector_execution_controls
         WHERE provider = 'ARSENKIN'
           AND capability = 'SERP_RANK_TRACKING'`
      );
      assert.equal(control.rows[0]?.submitEnabled, false);

      const stale = await createClaimableExecution(
        setup,
        enabledKillSwitchVersion
      );
      const firstFixture = await createClaimableExecution(
        setup,
        enabledKillSwitchVersion
      );
      const secondFixture = await createClaimableExecution(
        setup,
        enabledKillSwitchVersion
      );
      await driftCredential(setup, stale.credentialId);

      assert.equal(
        (
          await claim(
            setup,
            `closed-${suffix}`,
            CONNECTOR_VERSION
          )
        ).length,
        0
      );

      await setControl(
        setup,
        true,
        enabledKillSwitchVersion
      );

      const claims = await Promise.all([
        claim(first, `first-${suffix}`, CONNECTOR_VERSION),
        claim(second, `second-${suffix}`, CONNECTOR_VERSION)
      ]);
      const winners = claims.flat();
      assert.equal(winners.length, 2);
      assert.deepEqual(
        winners.map(({ executionId }) => executionId).sort(),
        [firstFixture.executionId, secondFixture.executionId].sort()
      );
      assert.equal(
        new Set(winners.map(({ leaseToken }) => leaseToken)).size,
        2
      );
      const winner = winners.find(
        ({ executionId }) => executionId === firstFixture.executionId
      );
      assert.ok(winner);
      assert.deepEqual(Object.keys(winner).sort(), [
        "authTag",
        "ciphertext",
        "credentialId",
        "credentialMaterialVersion",
        "dataKeyAuthTag",
        "dataKeyNonce",
        "encryptedDataKey",
        "executionId",
        "keyVersion",
        "leaseExpiresAt",
        "leaseToken",
        "nonce",
        "provider",
        "workspaceId"
      ]);
      assert.equal(winner.executionId, firstFixture.executionId);
      assert.equal(winner.workspaceId, firstFixture.workspaceId);
      assert.equal(winner.credentialId, firstFixture.credentialId);
      assert.equal(winner.provider, "ARSENKIN");
      assert.equal(winner.credentialMaterialVersion, 1);
      assert.deepEqual(winner.ciphertext, Buffer.from("01", "hex"));
      assert.deepEqual(winner.nonce, Buffer.alloc(12, 2));
      assert.deepEqual(winner.authTag, Buffer.alloc(16, 3));
      assert.deepEqual(
        winner.encryptedDataKey,
        Buffer.from("04", "hex")
      );
      assert.deepEqual(winner.dataKeyNonce, Buffer.alloc(12, 5));
      assert.deepEqual(winner.dataKeyAuthTag, Buffer.alloc(16, 6));
      assert.equal(winner.keyVersion, 1);

      const stored = await setup.query<{
        readonly status: string;
        readonly version: number;
        readonly leaseToken: string | null;
      }>(
        `SELECT status::text, version,
                lease_token::text AS "leaseToken"
         FROM rank_connector_executions
         WHERE id = $1::uuid`,
        [firstFixture.executionId]
      );
      assert.deepEqual(stored.rows[0], {
        status: "CLAIMED",
        version: 2,
        leaseToken: winner.leaseToken
      });

      assert.equal(
        (
          await claim(
            setup,
            `duplicate-${suffix}`,
            CONNECTOR_VERSION
          )
        ).length,
        0
      );

      await driftCredential(setup, firstFixture.credentialId);
      await delay(5_200);

      const secondInitial = winners.find(
        ({ executionId }) => executionId === secondFixture.executionId
      );
      assert.ok(secondInitial);
      const reclaimed = await claim(
        setup,
        `reclaim-${suffix}`,
        CONNECTOR_VERSION
      );
      assert.equal(reclaimed.length, 1);
      assert.equal(reclaimed[0]?.executionId, secondFixture.executionId);
      assert.notEqual(reclaimed[0]?.leaseToken, secondInitial.leaseToken);

      await cancelRankJob(setup, secondFixture);
      await delay(5_200);
      assert.equal(
        (
          await claim(
            setup,
            `cancelled-${suffix}`,
            CONNECTOR_VERSION
          )
        ).length,
        0
      );

      await setControl(setup, false, disabledKillSwitchVersion);
      assert.equal(
        (
          await claim(
            setup,
            `disabled-${suffix}`,
            CONNECTOR_VERSION
          )
        ).length,
        0
      );
      await assert.rejects(
        setControl(setup, true, enabledKillSwitchVersion),
        hasSqlState("23505")
      );

      const futureProvider = `TEST_${suffix.toUpperCase()}`;
      const initialFutureVersion = `initial@${suffix}`;
      const advancedFutureVersion = `advanced@${suffix}`;
      await setup.query(
        `INSERT INTO rank_connector_execution_controls (
           provider, capability, submit_enabled,
           execution_connector_version, provider_policy_version,
           kill_switch_version
         ) VALUES ($1, 'TEST_CAPABILITY', false, $2, $3, $4)`,
        [
          futureProvider,
          CONNECTOR_VERSION,
          POLICY_VERSION,
          initialFutureVersion
        ]
      );
      const initialHistory = await setup.query<{ readonly count: string }>(
        `SELECT count(*)::text AS count
         FROM rank_connector_execution_control_versions
         WHERE provider = $1
           AND capability = 'TEST_CAPABILITY'
           AND kill_switch_version = $2`,
        [futureProvider, initialFutureVersion]
      );
      assert.equal(initialHistory.rows[0]?.count, "1");
      await setup.query(
        `UPDATE rank_connector_execution_controls
         SET kill_switch_version = $2,
             version = version + 1,
             updated_at = clock_timestamp()
         WHERE provider = $1
           AND capability = 'TEST_CAPABILITY'`,
        [futureProvider, advancedFutureVersion]
      );
      await assert.rejects(
        setup.query(
          `UPDATE rank_connector_execution_controls
           SET kill_switch_version = $2,
               version = version + 1,
               updated_at = clock_timestamp()
           WHERE provider = $1
             AND capability = 'TEST_CAPABILITY'`,
          [futureProvider, initialFutureVersion]
        ),
        hasSqlState("23505")
      );

      await assert.rejects(
        setup.query(
          `UPDATE rank_connector_executions
           SET credential_id = uuidv7(), updated_at = clock_timestamp()
           WHERE id = $1::uuid`,
          [firstFixture.executionId]
        ),
        hasSqlState("55000")
      );

      const shadowFixture = await createClaimableExecution(
        setup,
        shadowKillSwitchVersion
      );
      await setControl(setup, true, shadowKillSwitchVersion);
      assert.match(restrictedRoleName, /^[a-z0-9_]+$/u);
      await setup.query(`CREATE ROLE "${restrictedRoleName}" NOLOGIN`);
      restrictedRoleCreated = true;
      await setup.query(
        `GRANT EXECUTE ON FUNCTION
           public.claim_rank_connector_execution(text, integer, text)
         TO "${restrictedRoleName}"`
      );

      await attacker.query(
        `CREATE TEMP TABLE rank_execution_grant_attempts (trap text)`
      );
      await attacker.query(
        `CREATE TEMP TABLE rank_connector_executions (trap text)`
      );
      await attacker.query("BEGIN");
      try {
        await attacker.query(`SET LOCAL ROLE "${restrictedRoleName}"`);
        await attacker.query("SET LOCAL search_path = pg_temp, public");
        const shadowClaim = await claim(
          attacker,
          `shadow-${suffix}`,
          CONNECTOR_VERSION
        );
        assert.equal(shadowClaim.length, 1);
        assert.equal(
          shadowClaim[0]?.executionId,
          shadowFixture.executionId
        );
        await attacker.query("COMMIT");
      } catch (error) {
        await attacker.query("ROLLBACK").catch(() => undefined);
        throw error;
      }

      const shadowStored = await setup.query<{
        readonly status: string;
        readonly version: number;
      }>(
        `SELECT status::text, version
         FROM public.rank_connector_executions
         WHERE id = $1::uuid`,
        [shadowFixture.executionId]
      );
      assert.deepEqual(shadowStored.rows[0], {
        status: "CLAIMED",
        version: 2
      });
    } finally {
      if (restrictedRoleCreated) {
        await setup.query(
          `REVOKE ALL ON FUNCTION
             public.claim_rank_connector_execution(text, integer, text)
           FROM "${restrictedRoleName}"`
        ).catch(() => undefined);
        await setup.query(
          `DROP ROLE IF EXISTS "${restrictedRoleName}"`
        ).catch(() => undefined);
      }
      await setControl(
        setup,
        false,
        cleanupKillSwitchVersion
      ).catch(() => undefined);
      await Promise.allSettled([
        setup.end(),
        first.end(),
        second.end(),
        attacker.end()
      ]);
    }
  }
);

interface ClaimFixture {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly executionId: string;
  readonly jobId: string;
  readonly actorId: string;
}

interface ClaimRow {
  readonly executionId: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  readonly workspaceId: string;
  readonly provider: string;
  readonly credentialId: string;
  readonly credentialMaterialVersion: number;
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly authTag: Buffer;
  readonly encryptedDataKey: Buffer;
  readonly dataKeyNonce: Buffer;
  readonly dataKeyAuthTag: Buffer;
  readonly keyVersion: number;
}

async function createClaimableExecution(
  client: Client,
  killSwitchVersion: string
): Promise<ClaimFixture> {
  const ids = await databaseUuidV7s(client, 15);
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
    grantAttemptId,
    grantId,
    trackingContextId
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
      grantAttemptId &&
      grantId &&
      trackingContextId
  );
  const executionId = await databaseUuidV7(client);
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
         $4, jsonb_build_object(
           'kind', 'integration.credential.validation.v1',
           'credentialId', $5::uuid::text,
           'credentialMaterialVersion', 1,
           'connectorVersion', $6::text
         ), '{}'::jsonb, 'BYOK_API_KEY', 'ARSENKIN',
         'rank-claim-postgres-validation', 1, $7::timestamptz,
         clock_timestamp()
       )`,
      [
        validationJobId,
        workspaceId,
        projectId,
        `rank-claim-validation:${validationJobId}`,
        credentialId,
        VALIDATION_CONNECTOR_VERSION,
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
         $1::uuid, $2::uuid, 'ARSENKIN', 'PostgreSQL claim fixture',
         'BYOK_API_KEY', 'ACTIVE', decode('01', 'hex'),
         decode(repeat('02', 12), 'hex'),
         decode(repeat('03', 16), 'hex'), decode('04', 'hex'),
         decode(repeat('05', 12), 'hex'),
         decode(repeat('06', 16), 'hex'), 1,
         '["SERP_RANK_TRACKING"]'::jsonb, $3,
         decode(repeat('07', 32), 'hex'), 1, 1, $4::timestamptz, 1,
         clock_timestamp()
       )`,
      [
        credentialId,
        workspaceId,
        `rank-claim-credential:${credentialId}`,
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
         decode(repeat('88', 32), 'hex'), decode(repeat('89', 32), 'hex'),
         decode(repeat('8a', 32), 'hex'), $10::uuid, 1, $11::uuid,
         $12::uuid, 'ACTIVE', 1, 1, $13::uuid, 1, $14,
         $15::timestamptz, $15::timestamptz, 'ARSENKIN', 'BYOK_API_KEY',
         $16, 1, 1, 1, 1, 1, '[]'::jsonb, '{}'::jsonb,
         '{}'::jsonb, decode($17, 'hex'), $15::timestamptz,
         $15::timestamptz + INTERVAL '5 minutes'
       )`,
      [
        estimateId,
        workspaceId,
        projectId,
        actorId,
        trackingContextId,
        `rank-claim-estimate:${projectId}`,
        `rank-claim-estimate:${estimateId}`,
        HASH.request,
        HASH.domain,
        bindingId,
        routeId,
        credentialId,
        validationJobId,
        VALIDATION_CONNECTOR_VERSION,
        verifiedAt,
        POLICY_VERSION,
        HASH.estimateExecution
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
         'BYOK_API_KEY', 'ARSENKIN', 20, 'rank-claim-postgres', 1,
         clock_timestamp()
       )`,
      [
        jobId,
        workspaceId,
        projectId,
        actorId,
        `rank-claim-dedup:${jobId}`,
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
         decode(repeat('8b', 32), 'hex'), clock_timestamp()
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
           version = version + 1, updated_at = clock_timestamp()
       WHERE id = $1::uuid`,
      [jobId]
    );
    await client.query(
      `UPDATE rank_job_runs
       SET seal_state = 'SEALED', manifest_id = $2::uuid,
           manifest_hash_schema = 'rank-manifest@1',
           manifest_hash = decode($3, 'hex'),
           manifest_deduplication_hash = decode($4, 'hex'),
           manifest_pair_count = 1, manifest_chunk_count = 1,
           manifest_chunk_size = 250, manifest_sealed_at = clock_timestamp(),
           updated_at = clock_timestamp()
       WHERE job_id = $1::uuid`,
      [jobId, manifestId, HASH.manifest, HASH.manifestDeduplication]
    );
    await client.query(
      `INSERT INTO job_items (
         id, workspace_id, project_id, job_id, sequence, status,
         input_reference, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, 0, 'QUEUED',
         jsonb_build_object(
           'schemaVersion', 'rank-job-item@1',
           'manifestId', $5::uuid::text,
           'chunkIndex', 0
         ), clock_timestamp()
       )`,
      [jobItemId, workspaceId, projectId, jobId, manifestId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  const decidedAt = new Date();
  const authorizationExpiresAt = new Date(decidedAt.getTime() + 30_000);
  const requestSnapshot = {
    schemaVersion: "rank-execution-grant-request@1",
    workspaceId,
    projectId,
    actorId,
    membership: { id: membershipId, version: 1 },
    project: {
      version: 1,
      domainHash: { algorithm: "SHA_256", value: HASH.domain }
    },
    jobId,
    jobItemId,
    jobVersion: 2,
    executionAttempt: 1,
    purpose: "PROVIDER_SUBMIT",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    capability: "SERP_RANK_TRACKING",
    credentialMode: "BYOK_API_KEY",
    manifest: {
      id: manifestId,
      hash: { algorithm: "SHA_256", value: HASH.manifest },
      chunkIndex: 0
    },
    executionEvidenceHash: {
      algorithm: "SHA_256",
      value: HASH.evidence
    },
    policyVersion: POLICY_VERSION,
    usageIntent: { meter: "RANK_PROVIDER_TASK", quantity: "1" }
  };
  const decisionSnapshot = {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "GRANTED",
    requestHash: { algorithm: "SHA_256", value: HASH.request },
    decidedAt: decidedAt.toISOString(),
    grant: {
      schemaVersion: "rank-execution-grant@1",
      id: grantId,
      requestHash: { algorithm: "SHA_256", value: HASH.request },
      scopeHash: { algorithm: "SHA_256", value: HASH.scope },
      issuer: "PLATFORM_API",
      issuedAt: decidedAt.toISOString(),
      expiresAt: authorizationExpiresAt.toISOString()
    }
  };

  await client.query("BEGIN");
  try {
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
        grantAttemptId,
        workspaceId,
        projectId,
        jobId,
        jobItemId,
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
        grantAttemptId,
        JSON.stringify(decisionSnapshot),
        decidedAt,
        authorizationExpiresAt
      ]
    );
    await client.query(
      `INSERT INTO rank_connector_executions (
         id, workspace_id, project_id, job_id, job_item_id,
         grant_attempt_id, execution_attempt, job_version, estimate_id,
         manifest_id, manifest_hash, manifest_chunk_index, binding_id,
         binding_version, route_id, credential_id, credential_version,
         credential_material_version, credential_validation_id,
         credential_validation_version,
         credential_validation_connector_version, credential_verified_at,
         estimate_execution_hash, execution_evidence_hash,
         execution_connector_version, provider_policy_version,
         kill_switch_version, authorization_expires_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
         1, 2, $7::uuid, $8::uuid, decode($9, 'hex'), 0, $10::uuid, 1,
         $11::uuid, $12::uuid, 1, 1, $13::uuid, 1, $14,
         $15::timestamptz, decode($16, 'hex'), decode($17, 'hex'),
         $18, $19, $20, $21::timestamptz, clock_timestamp()
       )`,
      [
        executionId,
        workspaceId,
        projectId,
        jobId,
        jobItemId,
        grantAttemptId,
        estimateId,
        manifestId,
        HASH.manifest,
        bindingId,
        routeId,
        credentialId,
        validationJobId,
        VALIDATION_CONNECTOR_VERSION,
        verifiedAt,
        HASH.estimateExecution,
        HASH.evidence,
        CONNECTOR_VERSION,
        POLICY_VERSION,
        killSwitchVersion,
        authorizationExpiresAt
      ]
    );
    await client.query(
      `UPDATE rank_execution_grant_attempts
       SET status = 'CONSUMED', terminal_at = clock_timestamp(),
           updated_at = clock_timestamp()
       WHERE id = $1::uuid`,
      [grantAttemptId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  return { workspaceId, credentialId, executionId, jobId, actorId };
}

async function claim(
  client: Client,
  leaseOwner: string,
  connectorVersion: string
): Promise<readonly ClaimRow[]> {
  const result = await client.query<ClaimRow>(
    `SELECT *
     FROM claim_rank_connector_execution($1::text, 5, $2::text)`,
    [leaseOwner, connectorVersion]
  );
  return result.rows;
}

async function setControl(
  client: Client,
  enabled: boolean,
  killSwitchVersion: string
): Promise<void> {
  await client.query(
    `UPDATE rank_connector_execution_controls
     SET submit_enabled = $1,
         execution_connector_version = $2,
         provider_policy_version = $3,
         kill_switch_version = $4,
         version = version + 1,
         updated_at = clock_timestamp()
     WHERE provider = 'ARSENKIN'
       AND capability = 'SERP_RANK_TRACKING'`,
    [enabled, CONNECTOR_VERSION, POLICY_VERSION, killSwitchVersion]
  );
}

async function driftCredential(
  client: Client,
  credentialId: string
): Promise<void> {
  await client.query(
    `UPDATE integration_credentials
     SET status = 'DISABLED', version = version + 1,
         updated_at = clock_timestamp()
     WHERE id = $1::uuid`,
    [credentialId]
  );
}

async function cancelRankJob(
  client: Client,
  fixture: ClaimFixture
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(
      `UPDATE jobs
       SET status = 'CANCEL_REQUESTED',
           cancel_requested_at = clock_timestamp(),
           version = version + 1,
           updated_at = clock_timestamp()
       WHERE id = $1::uuid`,
      [fixture.jobId]
    );
    await client.query(
      `UPDATE rank_job_runs
       SET cancel_requested_by = $2::uuid,
           updated_at = clock_timestamp()
       WHERE job_id = $1::uuid`,
      [fixture.jobId, fixture.actorId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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
