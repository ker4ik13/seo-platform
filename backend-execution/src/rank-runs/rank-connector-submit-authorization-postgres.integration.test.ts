import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.JOBS_RANK_TEST_DATABASE_URL;
const upgradeDatabaseUrl =
  process.env.JOBS_RANK_SUBMIT_UPGRADE_TEST_DATABASE_URL;
const enumMigration = readFile(
  new URL(
    "../../prisma/migrations/20260730101700_rank_connector_submitting_enum/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const authorizationMigration = readFile(
  new URL(
    "../../prisma/migrations/20260730101800_rank_connector_submit_authorization/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const CONNECTOR_VERSION = "arsenkin-positions@2.0.0";
const POLICY_VERSION = "manual-arsenkin-positions@1.0.0";
const VALIDATION_CONNECTOR_VERSION = "arsenkin@1.0.0";
const HASH = {
  request: "91".repeat(32),
  scope: "92".repeat(32),
  evidence: "93".repeat(32),
  domain: "94".repeat(32),
  manifest: "95".repeat(32),
  manifestDeduplication: "96".repeat(32),
  estimateExecution: "97".repeat(32),
  providerRequest: "9c".repeat(32),
  manifestChunk: "9d".repeat(32)
} as const;

test(
  "PostgreSQL 18 authorizes one exact pre-network submit and rejects stale leases/drift",
  { skip: databaseUrl === undefined, timeout: 45_000 },
  async () => {
    assert.ok(databaseUrl);
    const setup = await connectedClient(databaseUrl);
    const first = await connectedClient(databaseUrl);
    const second = await connectedClient(databaseUrl);
    const attacker = await connectedClient(databaseUrl);
    const suffix = Date.now().toString(36);
    const enabledKillSwitchVersion = `authorize-enabled@${suffix}`;
    const driftedKillSwitchVersion = `authorize-drifted@${suffix}`;
    const cleanupKillSwitchVersion = `authorize-cleanup@${suffix}`;
    const restrictedRoleName = `rank_authorize_${suffix}`;
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
      assert.equal(control.rows[0]?.submitEnabled, true);

      const exactFixture = await createClaimableExecution(
        setup,
        enabledKillSwitchVersion
      );
      assert.equal(
        (await claim(setup, `closed-${suffix}`)).length,
        0
      );

      await setControl(setup, true, enabledKillSwitchVersion);
      const exactClaim = only(
        await claim(setup, `exact-${suffix}`)
      );
      assert.equal(exactClaim.executionId, exactFixture.executionId);
      assert.equal(exactClaim.leaseGeneration, 1);
      assert.equal(exactClaim.executionVersion, 2);
      assert.deepEqual(
        await billingSettlement(setup, exactFixture, exactClaim),
        [{
          grantId: exactFixture.grantId,
          credentialMode: "BYOK_API_KEY"
        }]
      );

      await assert.rejects(
        authorize(setup, exactFixture, exactClaim, {
          leaseOwner: "bad owner"
        }),
        hasSqlState("22023")
      );

      const wrongWorkspaceId = await databaseUuidV7(setup);
      const wrongLeaseToken = await databaseUuidV7(setup);
      for (const override of [
        { workspaceId: wrongWorkspaceId },
        { leaseOwner: `wrong-${suffix}` },
        { leaseToken: wrongLeaseToken },
        { leaseGeneration: exactClaim.leaseGeneration + 1 },
        { expectedVersion: exactClaim.executionVersion + 1 },
        { connectorVersion: "arsenkin-positions@9.9.9" }
      ] satisfies readonly AuthorizeOverrides[]) {
        assert.equal(
          (await authorize(setup, exactFixture, exactClaim, override)).length,
          0
        );
      }

      const permit = only(
        await authorize(setup, exactFixture, exactClaim)
      );
      assert.equal(
        (await billingSettlement(setup, exactFixture, exactClaim)).length,
        0
      );
      assert.deepEqual(Object.keys(permit).sort(), [
        "authorizationExpiresAt",
        "executionId",
        "executionVersion",
        "jobId",
        "jobItemId",
        "leaseGeneration",
        "submitAttemptCount",
        "submitBytesStartedAt",
        "workspaceId"
      ]);
      assert.equal(permit.executionId, exactFixture.executionId);
      assert.equal(permit.workspaceId, exactFixture.workspaceId);
      assert.equal(permit.jobId, exactFixture.jobId);
      assert.equal(permit.jobItemId, exactFixture.jobItemId);
      assert.equal(permit.leaseGeneration, 1);
      assert.equal(permit.executionVersion, 3);
      assert.equal(permit.submitAttemptCount, 1);
      assert.ok(permit.submitBytesStartedAt instanceof Date);

      const stored = await readExecution(setup, exactFixture.executionId);
      assert.equal(stored.status, "SUBMITTING");
      assert.equal(stored.leaseGeneration, 1);
      assert.equal(stored.version, 3);
      assert.equal(stored.submitAttemptCount, 1);
      assert.ok(stored.submitBytesStartedAt instanceof Date);
      assert.equal(
        (await authorize(setup, exactFixture, exactClaim)).length,
        0
      );

      const driftFixture = await createClaimableExecution(
        setup,
        enabledKillSwitchVersion
      );
      const driftClaim = only(
        await claim(setup, `credential-drift-${suffix}`)
      );
      assert.equal(driftClaim.executionId, driftFixture.executionId);
      await driftCredential(setup, driftFixture.credentialId);
      assert.equal(
        (await authorize(setup, driftFixture, driftClaim)).length,
        0
      );

      const concurrentFixture = await createClaimableExecution(
        setup,
        enabledKillSwitchVersion
      );
      const concurrentClaim = only(
        await claim(setup, `concurrent-${suffix}`)
      );
      const concurrentPermits = (
        await Promise.all([
          authorize(first, concurrentFixture, concurrentClaim),
          authorize(second, concurrentFixture, concurrentClaim)
        ])
      ).flat();
      assert.equal(concurrentPermits.length, 1);
      assert.equal(
        concurrentPermits[0]?.executionId,
        concurrentFixture.executionId
      );

      const rollbackFixture = await createClaimableExecution(
        setup,
        enabledKillSwitchVersion
      );
      const rollbackClaim = only(
        await claim(setup, `rollback-${suffix}`)
      );
      await setup.query("BEGIN");
      try {
        assert.equal(
          (await authorize(setup, rollbackFixture, rollbackClaim)).length,
          1
        );
        await setup.query("ROLLBACK");
      } catch (error) {
        await setup.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      assert.deepEqual(
        await readExecution(setup, rollbackFixture.executionId),
        {
          status: "CLAIMED",
          leaseGeneration: 1,
          version: 2,
          submitAttemptCount: 0,
          submitBytesStartedAt: null
        }
      );
      assert.equal(
        (await authorize(setup, rollbackFixture, rollbackClaim)).length,
        1
      );

      const cancelledFixture = await createClaimableExecution(
        setup,
        enabledKillSwitchVersion
      );
      const cancelledClaim = only(
        await claim(setup, `cancelled-${suffix}`)
      );
      await cancelRankJob(setup, cancelledFixture);
      assert.equal(
        (await authorize(setup, cancelledFixture, cancelledClaim)).length,
        0
      );

      const shadowFixture = await createClaimableExecution(
        setup,
        enabledKillSwitchVersion
      );
      const shadowClaim = only(
        await claim(setup, `shadow-${suffix}`)
      );
      assert.match(restrictedRoleName, /^[a-z0-9_]+$/u);
      await setup.query(`CREATE ROLE "${restrictedRoleName}" NOLOGIN`);
      restrictedRoleCreated = true;
      const publicExecute = await setup.query<{
        readonly authorizationPublicExecute: boolean;
        readonly settlementPublicExecute: boolean;
      }>(
        `SELECT
           EXISTS (
             SELECT 1
             FROM pg_proc procedure
             CROSS JOIN LATERAL aclexplode(COALESCE(
               procedure.proacl,
               acldefault('f', procedure.proowner)
             )) acl
             WHERE procedure.oid =
               'public.authorize_rank_connector_execution_submit(uuid,uuid,text,uuid,integer,integer,text)'::regprocedure
               AND acl.grantee = 0
               AND acl.privilege_type = 'EXECUTE'
           ) AS "authorizationPublicExecute",
           EXISTS (
             SELECT 1
             FROM pg_proc procedure
             CROSS JOIN LATERAL aclexplode(COALESCE(
               procedure.proacl,
               acldefault('f', procedure.proowner)
             )) acl
             WHERE procedure.oid =
               'public.read_rank_connector_billing_settlement(uuid,uuid,text,uuid,integer,integer)'::regprocedure
               AND acl.grantee = 0
               AND acl.privilege_type = 'EXECUTE'
           ) AS "settlementPublicExecute"`
      );
      assert.equal(
        publicExecute.rows[0]?.authorizationPublicExecute,
        false
      );
      assert.equal(publicExecute.rows[0]?.settlementPublicExecute, false);
      await setup.query(
        `GRANT EXECUTE ON FUNCTION
           public.authorize_rank_connector_execution_submit(
             uuid, uuid, text, uuid, integer, integer, text
           ) TO "${restrictedRoleName}"`
      );
      await setup.query(
        `GRANT EXECUTE ON FUNCTION
           public.read_rank_connector_billing_settlement(
             uuid, uuid, text, uuid, integer, integer
           ) TO "${restrictedRoleName}"`
      );
      for (const relation of [
        "jobs",
        "rank_job_runs",
        "job_items",
        "integration_credentials",
        "project_connector_bindings",
        "project_connector_routes",
        "rank_execution_grant_attempts",
        "rank_connector_executions",
        "rank_connector_execution_controls"
      ]) {
        assert.match(relation, /^[a-z_]+$/u);
        await attacker.query(`CREATE TEMP TABLE ${relation} (trap text)`);
      }
      await attacker.query("BEGIN");
      try {
        await attacker.query(`SET LOCAL ROLE "${restrictedRoleName}"`);
        await assert.rejects(
          attacker.query(
            "SELECT 1 FROM public.rank_connector_executions LIMIT 1"
          ),
          hasSqlState("42501")
        );
      } finally {
        await attacker.query("ROLLBACK").catch(() => undefined);
      }
      await attacker.query("BEGIN");
      try {
        await attacker.query(`SET LOCAL ROLE "${restrictedRoleName}"`);
        await attacker.query("SET LOCAL search_path = pg_temp, public");
        assert.deepEqual(
          await billingSettlement(
            attacker,
            shadowFixture,
            shadowClaim
          ),
          [{
            grantId: shadowFixture.grantId,
            credentialMode: "BYOK_API_KEY"
          }]
        );
        assert.equal(
          (await authorize(attacker, shadowFixture, shadowClaim)).length,
          1
        );
        await attacker.query("COMMIT");
      } catch (error) {
        await attacker.query("ROLLBACK").catch(() => undefined);
        throw error;
      }

      const controlDriftFixture = await createClaimableExecution(
        setup,
        enabledKillSwitchVersion
      );
      const controlDriftClaim = only(
        await claim(setup, `control-drift-${suffix}`)
      );
      await setControl(setup, true, driftedKillSwitchVersion);
      assert.equal(
        (
          await authorize(
            setup,
            controlDriftFixture,
            controlDriftClaim
          )
        ).length,
        0
      );

      const expiredFixture = await createClaimableExecution(
        setup,
        driftedKillSwitchVersion
      );
      const expiredClaim = only(
        await claim(setup, `expired-${suffix}`)
      );
      await delay(5_200);
      assert.equal(
        (await authorize(setup, expiredFixture, expiredClaim)).length,
        0
      );
    } finally {
      if (restrictedRoleCreated) {
        await setup.query(
          `REVOKE ALL ON FUNCTION
             public.read_rank_connector_billing_settlement(
               uuid, uuid, text, uuid, integer, integer
             ) FROM "${restrictedRoleName}"`
        ).catch(() => undefined);
        await setup.query(
          `REVOKE ALL ON FUNCTION
             public.authorize_rank_connector_execution_submit(
               uuid, uuid, text, uuid, integer, integer, text
             ) FROM "${restrictedRoleName}"`
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

test(
  "PostgreSQL 18 upgrade revokes every inherited claim EXECUTE ACL",
  { skip: upgradeDatabaseUrl === undefined, timeout: 20_000 },
  async () => {
    assert.ok(upgradeDatabaseUrl);
    const client = await connectedClient(upgradeDatabaseUrl);
    const suffix = Date.now().toString(36);
    const roleName = `rank_upgrade_${suffix}`;
    let roleCreated = false;

    try {
      await assertPostgres18(client);
      const precondition = await client.query<{
        readonly oldClaim: string | null;
        readonly privateClaim: string | null;
      }>(
        `SELECT
           to_regprocedure(
             'public.claim_rank_connector_execution(text,integer,text)'
           )::text AS "oldClaim",
           to_regprocedure(
             'public.claim_rank_connector_execution_pre_authorization(text,integer,text)'
           )::text AS "privateClaim"`
      );
      assert.ok(precondition.rows[0]?.oldClaim);
      assert.equal(precondition.rows[0]?.privateClaim, null);

      assert.match(roleName, /^[a-z0-9_]+$/u);
      await client.query(`CREATE ROLE "${roleName}" NOLOGIN`);
      roleCreated = true;
      await client.query(
        `GRANT EXECUTE ON FUNCTION
           public.claim_rank_connector_execution(text, integer, text)
         TO "${roleName}"`
      );
      assert.equal(
        await hasFunctionPrivilege(
          client,
          roleName,
          "public.claim_rank_connector_execution(text,integer,text)"
        ),
        true
      );

      await client.query(await enumMigration);
      await client.query(await authorizationMigration);

      assert.equal(
        await hasFunctionPrivilege(
          client,
          roleName,
          "public.claim_rank_connector_execution_pre_authorization(text,integer,text)"
        ),
        false
      );
      assert.equal(
        await hasFunctionPrivilege(
          client,
          roleName,
          "public.claim_rank_connector_execution(text,integer,text)"
        ),
        false
      );

      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE "${roleName}"`);
        await assert.rejects(
          client.query(
            `SELECT * FROM
             public.claim_rank_connector_execution_pre_authorization(
               'upgrade-regression', 5, $1::text
             )`,
            [CONNECTOR_VERSION]
          ),
          hasSqlState("42501")
        );
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
      }
    } finally {
      if (roleCreated) {
        await client.query(`DROP ROLE IF EXISTS "${roleName}"`)
          .catch(() => undefined);
      }
      await client.end();
    }
  }
);

interface ClaimFixture {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly credentialId: string;
  readonly executionId: string;
  readonly grantId: string;
  readonly jobId: string;
  readonly jobItemId: string;
}

interface ClaimRow {
  readonly executionId: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  readonly leaseGeneration: number;
  readonly executionVersion: number;
}

interface AuthorizeRow {
  readonly executionId: string;
  readonly workspaceId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly leaseGeneration: number;
  readonly executionVersion: number;
  readonly submitAttemptCount: number;
  readonly submitBytesStartedAt: Date;
  readonly authorizationExpiresAt: Date;
}

interface AuthorizeOverrides {
  readonly workspaceId?: string;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly leaseGeneration?: number;
  readonly expectedVersion?: number;
  readonly connectorVersion?: string;
}

interface StoredExecution {
  readonly status: string;
  readonly leaseGeneration: number;
  readonly version: number;
  readonly submitAttemptCount: number;
  readonly submitBytesStartedAt: Date | null;
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
  const providerRequestIntentId = await databaseUuidV7(client);
  const verifiedAt = new Date();

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO jobs (
         id, workspace_id, project_id, type, status, stage,
         idempotency_scope, deduplication_key, input_snapshot, scope_snapshot,
         credential_mode, provider, correlation_id, version,
         finished_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid,
         'INTEGRATION_CREDENTIAL_VALIDATE', 'COMPLETED', 'FINISHED',
         $4,
         'integration-credential-validation:' || $5::uuid::text || ':1',
         jsonb_build_object(
           'kind', 'integration.credential.validation.v1',
           'credentialId', $5::uuid::text,
           'credentialMaterialVersion', 1,
           'connectorVersion', $6::text
         ), '{}'::jsonb, 'BYOK_API_KEY', 'ARSENKIN',
         'rank-authorize-postgres-validation', 1, $7::timestamptz,
         clock_timestamp()
       )`,
      [
        validationJobId,
        workspaceId,
        projectId,
        `rank-authorize-validation:${validationJobId}`,
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
         $1::uuid, $2::uuid, 'ARSENKIN', 'PostgreSQL authorize fixture',
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
        `rank-authorize-credential:${credentialId}`,
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
         decode(repeat('98', 32), 'hex'), decode(repeat('99', 32), 'hex'),
         decode(repeat('9a', 32), 'hex'), $10::uuid, 1, $11::uuid,
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
        `rank-authorize-estimate:${projectId}`,
        `rank-authorize-estimate:${estimateId}`,
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
         'BYOK_API_KEY', 'ARSENKIN', 20, 'rank-authorize-postgres', 1,
         clock_timestamp()
       )`,
      [
        jobId,
        workspaceId,
        projectId,
        actorId,
        `rank-authorize-dedup:${jobId}`,
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
         decode(repeat('9b', 32), 'hex'), clock_timestamp()
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

  await client.query(
    `UPDATE jobs
     SET status = 'RUNNING', stage = 'WAITING_EXECUTION_GRANT',
         started_at = clock_timestamp(), version = version + 1,
         updated_at = clock_timestamp()
     WHERE id = $1::uuid`,
    [jobId]
  );

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
    jobVersion: 3,
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
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1, 3,
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
      `INSERT INTO rank_provider_request_intents (
         id, workspace_id, project_id, job_id, job_item_id,
         manifest_id, manifest_hash, manifest_chunk_index,
         manifest_chunk_hash, schema_version, request_snapshot,
         request_hash
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
         $6::uuid, decode($7, 'hex'), 0, decode($8, 'hex'),
         'rank-provider-request-intent@1', '{}'::jsonb,
         decode($9, 'hex')
       )`,
      [
        providerRequestIntentId,
        workspaceId,
        projectId,
        jobId,
        jobItemId,
        manifestId,
        HASH.manifest,
        HASH.manifestChunk,
        HASH.providerRequest
      ]
    );
    await client.query(
      `INSERT INTO rank_connector_executions (
         id, workspace_id, project_id, job_id, job_item_id,
         grant_attempt_id, execution_attempt, job_version, estimate_id,
         manifest_id, manifest_hash, manifest_chunk_index,
         provider_request_intent_id, provider_request_intent_hash,
         provider_request_intent_chunk_hash, binding_id,
         binding_version, route_id, credential_id, credential_version,
         credential_material_version, credential_validation_id,
         credential_validation_version,
         credential_validation_connector_version, credential_verified_at,
         estimate_execution_hash, execution_evidence_hash,
         execution_connector_version, provider_policy_version,
         kill_switch_version, authorization_expires_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
         1, 3, $7::uuid, $8::uuid, decode($9, 'hex'), 0,
         $10::uuid, decode($11, 'hex'), decode($12, 'hex'),
         $13::uuid, 1, $14::uuid, $15::uuid, 1, 1, $16::uuid, 1, $17,
         $18::timestamptz, decode($19, 'hex'), decode($20, 'hex'),
         $21, $22, $23, $24::timestamptz, clock_timestamp()
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
        providerRequestIntentId,
        HASH.providerRequest,
        HASH.manifestChunk,
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

  return {
    workspaceId,
    actorId,
    credentialId,
    executionId,
    grantId,
    jobId,
    jobItemId
  };
}

async function billingSettlement(
  client: Client,
  fixture: ClaimFixture,
  claimed: ClaimRow
): Promise<readonly {
  readonly grantId: string;
  readonly credentialMode: string;
}[]> {
  const result = await client.query<{
    readonly grantId: string;
    readonly credentialMode: string;
  }>(
    `SELECT *
     FROM public.read_rank_connector_billing_settlement(
       $1::uuid, $2::uuid, $3::text, $4::uuid,
       $5::integer, $6::integer
     )`,
    [
      fixture.workspaceId,
      fixture.executionId,
      claimedLeaseOwner(claimed),
      claimed.leaseToken,
      claimed.leaseGeneration,
      claimed.executionVersion
    ]
  );
  return result.rows;
}

async function claim(
  client: Client,
  leaseOwner: string
): Promise<readonly ClaimRow[]> {
  const result = await client.query<ClaimRow>(
    `SELECT "executionId", "leaseToken", "leaseExpiresAt",
            "leaseGeneration", "executionVersion"
     FROM public.claim_rank_connector_execution($1::text, 5, $2::text)`,
    [leaseOwner, CONNECTOR_VERSION]
  );
  for (const row of result.rows) {
    claimOwners.set(row.leaseToken, leaseOwner);
  }
  return result.rows;
}

async function authorize(
  client: Client,
  fixture: ClaimFixture,
  claimed: ClaimRow,
  override: AuthorizeOverrides = {}
): Promise<readonly AuthorizeRow[]> {
  const result = await client.query<AuthorizeRow>(
    `SELECT *
     FROM public.authorize_rank_connector_execution_submit(
       $1::uuid, $2::uuid, $3::text, $4::uuid,
       $5::integer, $6::integer, $7::text
     )`,
    [
      override.workspaceId ?? fixture.workspaceId,
      fixture.executionId,
      override.leaseOwner ?? claimedLeaseOwner(claimed),
      override.leaseToken ?? claimed.leaseToken,
      override.leaseGeneration ?? claimed.leaseGeneration,
      override.expectedVersion ?? claimed.executionVersion,
      override.connectorVersion ?? CONNECTOR_VERSION
    ]
  );
  return result.rows;
}

const claimOwners = new Map<string, string>();

function claimedLeaseOwner(claimed: ClaimRow): string {
  const owner = claimOwners.get(claimed.leaseToken);
  assert.ok(owner);
  return owner;
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

async function readExecution(
  client: Client,
  executionId: string
): Promise<StoredExecution> {
  const result = await client.query<StoredExecution>(
    `SELECT status::text,
            lease_generation AS "leaseGeneration",
            version,
            submit_attempt_count AS "submitAttemptCount",
            submit_bytes_started_at AS "submitBytesStartedAt"
     FROM rank_connector_executions
     WHERE id = $1::uuid`,
    [executionId]
  );
  return only(result.rows);
}

function only<T>(rows: readonly T[]): T {
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  return row;
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

async function hasFunctionPrivilege(
  client: Client,
  roleName: string,
  signature: string
): Promise<boolean> {
  const result = await client.query<{ readonly allowed: boolean }>(
    `SELECT has_function_privilege(
       $1::name,
       $2::text,
       'EXECUTE'
     ) AS allowed`,
    [roleName, signature]
  );
  return result.rows[0]?.allowed ?? false;
}

function hasSqlState(expected: string): (error: unknown) => boolean {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === expected;
}
