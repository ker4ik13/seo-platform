import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test from "node:test";
import { Client } from "pg";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  IntegrationCredentialExecutionBrokerService
} from "./integration-credential-execution-broker.service.js";

const databaseUrl =
  process.env.JOBS_CREDENTIAL_BROKER_TEST_DATABASE_URL ??
  process.env.JOBS_RANK_TEST_DATABASE_URL;
const connectorVersion = "keys-so@1.0.0";
const arsenkinConnectorVersion = "arsenkin@1.0.0";

test(
  "PostgreSQL 18 isolates credential validation behind a lease-bound broker",
  { skip: databaseUrl === undefined, timeout: 30_000 },
  async () => {
    assert.ok(databaseUrl);
    const setup = await connectedClient(databaseUrl);
    const first = await connectedClient(databaseUrl);
    const second = await connectedClient(databaseUrl);
    const suffix = `${Date.now().toString(36)}${randomInt(1_000, 9_999)}`;
    const restrictedRole = `credential_broker_${suffix}`;
    const keyVersion = 100_000 + randomInt(1, 700_000);
    const configuredUnusedKeyVersion = keyVersion + 1;
    const retiredUnusedKeyVersion = keyVersion + 2;
    const missingRequestedKeyVersion = keyVersion + 3;
    const missingUsedKeyVersion = keyVersion + 4;
    let roleCreated = false;

    try {
      await assertPostgres18(setup);
      assert.match(restrictedRole, /^[a-z0-9_]+$/u);
      await setup.query(
        `CREATE ROLE "${restrictedRole}"
         NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
         NOINHERIT NOREPLICATION NOBYPASSRLS`
      );
      roleCreated = true;

      await assertPublicBrokerBypassClosed(setup, restrictedRole);
      await grantConnectorBroker(setup, restrictedRole);
      await assertInvalidExecutionCanaryRequests(
        first,
        restrictedRole,
        keyVersion
      );

      const canaryCiphertext = Buffer.from("synthetic-kek-canary");
      await setup.query(
        `SELECT *
         FROM public.register_integration_credential_kek_canary(
           $1::integer, $2::bytea,
           decode(repeat('11', 12), 'hex'),
           decode(repeat('12', 16), 'hex'),
           decode('13', 'hex'),
           decode(repeat('14', 12), 'hex'),
           decode(repeat('15', 16), 'hex')
         )`,
        [keyVersion, canaryCiphertext]
      );
      const replacement = await setup.query<CanaryRow>(
        `SELECT *
         FROM public.register_integration_credential_kek_canary(
           $1::integer, decode('ff', 'hex'),
           decode(repeat('f1', 12), 'hex'),
           decode(repeat('f2', 16), 'hex'), decode('f3', 'hex'),
           decode(repeat('f4', 12), 'hex'),
           decode(repeat('f5', 16), 'hex')
         )`,
        [keyVersion]
      );
      assert.deepEqual(replacement.rows[0]?.ciphertext, canaryCiphertext);
      const configuredUnusedCiphertext = Buffer.from(
        "configured-unused-kek-canary"
      );
      const retiredUnusedCiphertext = Buffer.from(
        "retired-unused-kek-canary"
      );
      await registerSyntheticCanary(
        setup,
        configuredUnusedKeyVersion,
        configuredUnusedCiphertext
      );
      await registerSyntheticCanary(
        setup,
        retiredUnusedKeyVersion,
        retiredUnusedCiphertext
      );
      await assert.rejects(
        setup.query(
          `UPDATE public.integration_credential_kek_canaries
           SET ciphertext = decode('ff', 'hex')
           WHERE key_version = $1::integer`,
          [keyVersion]
        ),
        hasSqlState("55000")
      );
      const fixture = await createValidation(setup, keyVersion, suffix);
      await createValidation(
        setup,
        missingUsedKeyVersion,
        `${suffix}-missing-used-canary`
      );
      await assertExecutionCanaryProjectionBound(first, restrictedRole);

      await assertRestrictedTableAndManagementAccess(
        first,
        restrictedRole,
        keyVersion
      );
      const projectedCanaries = await asRole(first, restrictedRole, () =>
        first.query<CanaryRow>(
          `SELECT *
           FROM public.list_integration_credential_execution_kek_canaries(
             $1::text[]
           )`,
          [[
            String(keyVersion),
            String(configuredUnusedKeyVersion),
            String(missingRequestedKeyVersion)
          ]]
        )
      );
      const projected = projectedCanaries.rows.find(
        (row) => row.keyVersion === keyVersion
      );
      assert.ok(projected);
      assert.equal(projected.usedByCredential, true);
      assert.deepEqual(projected.ciphertext, canaryCiphertext);
      assert.notDeepEqual(projected.ciphertext, fixture.tenantCiphertext);
      const configuredUnused = projectedCanaries.rows.find(
        (row) => row.keyVersion === configuredUnusedKeyVersion
      );
      assert.ok(configuredUnused);
      assert.equal(configuredUnused.usedByCredential, false);
      assert.deepEqual(
        configuredUnused.ciphertext,
        configuredUnusedCiphertext
      );
      assert.equal(
        projectedCanaries.rows.some(
          (row) => row.keyVersion === retiredUnusedKeyVersion
        ),
        false
      );
      assert.deepEqual(
        projectedCanaries.rows
          .filter(({ keyVersion: version }) =>
            [missingRequestedKeyVersion, missingUsedKeyVersion].includes(
              version
            )
          )
          .map(({ keyVersion: version, usedByCredential, ciphertext }) => ({
            keyVersion: version,
            usedByCredential,
            ciphertext
          })),
        [
          {
            keyVersion: missingRequestedKeyVersion,
            usedByCredential: false,
            ciphertext: null
          },
          {
            keyVersion: missingUsedKeyVersion,
            usedByCredential: true,
            ciphertext: null
          }
        ]
      );

      const due = await asRole(first, restrictedRole, () =>
        first.query<{ readonly validationId: string }>(
          `SELECT *
           FROM public.list_due_integration_credential_validations(100)`
        )
      );
      assert.equal(
        due.rows.some(({ validationId }) => validationId === fixture.jobId),
        true
      );

      const arbitrary = await databaseUuidV7(setup);
      const arbitraryClaim = await claim(
        first,
        restrictedRole,
        arbitrary,
        `arbitrary-${suffix}`
      );
      assert.deepEqual(arbitraryClaim, []);
      const otherJobId = await createNonValidationJob(setup, suffix);
      assert.deepEqual(
        await claim(
          first,
          restrictedRole,
          otherJobId,
          `other-${suffix}`
        ),
        []
      );
      await verifyCorruptedScopes(
        setup,
        first,
        restrictedRole,
        keyVersion,
        suffix
      );
      await verifyNullFinishInputs(
        setup,
        first,
        restrictedRole,
        keyVersion,
        `${suffix}-null-finish`
      );
      await verifyLeaseStartsAfterCredentialLockWait(
        setup,
        first,
        restrictedRole,
        keyVersion,
        `${suffix}-fresh-lease`
      );
      await verifyArsenkinSuccessMetadataRequired(
        setup,
        first,
        restrictedRole,
        keyVersion,
        `${suffix}-arsenkin-meta`
      );

      await setup.query(`GRANT TEMPORARY ON DATABASE jobs_db TO "${restrictedRole}"`);
      await asRole(first, restrictedRole, async () => {
        await first.query("CREATE TEMP TABLE jobs (trap text)");
        await first.query(
          "CREATE TEMP TABLE integration_credentials (trap text)"
        );
        await first.query(
          `CREATE FUNCTION pg_temp.uuidv7()
           RETURNS uuid
           LANGUAGE sql
           IMMUTABLE
           AS 'SELECT ''00000000-0000-7000-8000-000000000001''::uuid'`
        );
      });

      const claims = await Promise.all([
        claim(first, restrictedRole, fixture.jobId, `first-${suffix}`),
        claim(second, restrictedRole, fixture.jobId, `second-${suffix}`)
      ]);
      const rows = claims.flat();
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map(({ claimOutcome }) => claimOutcome).sort(),
        ["CLAIMED", "NOT_CLAIMABLE"]
      );
      const winner = rows.find(({ claimOutcome }) => claimOutcome === "CLAIMED");
      assert.ok(winner?.leaseToken);
      assert.notEqual(
        winner.leaseToken,
        "00000000-0000-7000-8000-000000000001"
      );
      assert.equal(winner.scopeState, "READY");
      assert.deepEqual(winner.ciphertext, fixture.tenantCiphertext);
      assert.equal(winner.jobVersion, 2);

      await setup.query(
        `UPDATE public.jobs
         SET lease_expires_at = clock_timestamp() - interval '1 second'
         WHERE id = $1::uuid`,
        [fixture.jobId]
      );
      const reclaimedRows = await claim(
        second,
        restrictedRole,
        fixture.jobId,
        `reclaim-${suffix}`
      );
      assert.equal(reclaimedRows.length, 1);
      const reclaimed = reclaimedRows[0];
      assert.equal(reclaimed?.claimOutcome, "CLAIMED");
      assert.ok(reclaimed?.leaseToken);
      assert.notEqual(reclaimed.leaseToken, winner.leaseToken);

      const staleFinish = await finishJobFailure(
        first,
        restrictedRole,
        fixture.jobId,
        winner.leaseOwner,
        winner.leaseToken,
        winner.jobVersion,
        "CREDENTIAL_DECRYPTION_FAILED"
      );
      assert.deepEqual(staleFinish, []);
      const stillReclaimed = await setup.query<{
        readonly leaseToken: string;
        readonly status: string;
      }>(
        `SELECT validation_lease_token::text AS "leaseToken", status::text
         FROM public.jobs WHERE id = $1::uuid`,
        [fixture.jobId]
      );
      assert.deepEqual(stillReclaimed.rows[0], {
        leaseToken: reclaimed.leaseToken,
        status: "RUNNING"
      });

      const success = await finishSuccess(
        second,
        restrictedRole,
        reclaimed,
        { apiRequest: { limit: 100, usedLimit: 4 } }
      );
      assert.equal(success[0]?.jobStatus, "COMPLETED");
      const successState = await setup.query<{
        readonly jobStatus: string;
        readonly credentialStatus: string;
        readonly capabilities: unknown;
        readonly providerMeta: unknown;
      }>(
        `SELECT job.status::text AS "jobStatus",
                credential.status::text AS "credentialStatus",
                credential.capabilities,
                credential.provider_meta AS "providerMeta"
         FROM public.jobs job
         JOIN public.integration_credentials credential
           ON credential.id = $2::uuid
         WHERE job.id = $1::uuid`,
        [fixture.jobId, fixture.credentialId]
      );
      assert.deepEqual(successState.rows[0], {
        jobStatus: "COMPLETED",
        credentialStatus: "ACTIVE",
        capabilities: [
          "KEYWORD_RESEARCH",
          "COMPETITOR_RESEARCH",
          "SERP_COLLECTION"
        ],
        providerMeta: { apiRequest: { limit: 100, usedLimit: 4 } }
      });

      const terminal = await claim(
        first,
        restrictedRole,
        fixture.jobId,
        `terminal-${suffix}`
      );
      assert.equal(terminal[0]?.claimOutcome, "TERMINAL");
      assert.equal(terminal[0]?.leaseToken, null);
      assert.equal(terminal[0]?.ciphertext, null);

      await verifyProviderFailureAndUtc(
        setup,
        first,
        restrictedRole,
        keyVersion,
        `${suffix}-rate`
      );
      await verifyMaterialDrift(
        setup,
        first,
        restrictedRole,
        keyVersion,
        `${suffix}-drift`
      );
      await verifyTypeScriptBrokerRoundTrip(
        setup,
        databaseUrl,
        keyVersion,
        configuredUnusedKeyVersion,
        retiredUnusedKeyVersion,
        missingRequestedKeyVersion,
        missingUsedKeyVersion,
        canaryCiphertext,
        configuredUnusedCiphertext,
        `${suffix}-typescript`
      );
    } finally {
      await Promise.allSettled([first.end(), second.end()]);
      if (roleCreated) {
        await setup
          .query(`DROP OWNED BY "${restrictedRole}"`)
          .catch(() => undefined);
        await setup
          .query(`DROP ROLE IF EXISTS "${restrictedRole}"`)
          .catch(() => undefined);
      }
      await setup.end();
    }
  }
);

interface ValidationFixture {
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly jobId: string;
  readonly tenantCiphertext: Buffer;
}

interface ClaimRow {
  readonly claimOutcome: string;
  readonly scopeState: string;
  readonly validationId: string;
  readonly leaseToken: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly jobVersion: number;
  readonly workspaceId: string;
  readonly credentialId: string;
  readonly credentialMaterialVersion: number;
  readonly connectorVersion: string;
  readonly ciphertext: Buffer | null;
  readonly jobStatus: string;
}

async function verifyLeaseStartsAfterCredentialLockWait(
  setup: Client,
  connector: Client,
  role: string,
  keyVersion: number,
  suffix: string
): Promise<void> {
  const fixture = await createValidation(setup, keyVersion, suffix);
  const backend = await connector.query<{ readonly pid: number }>(
    `SELECT pg_backend_pid() AS pid`
  );
  const backendPid = backend.rows[0]?.pid;
  assert.ok(backendPid);

  await setup.query("BEGIN");
  let pendingClaim:
    | Promise<readonly (ClaimRow & { readonly leaseOwner: string })[]>
    | undefined;
  try {
    await setup.query(
      `SELECT 1
       FROM public.integration_credentials
       WHERE workspace_id = $1::uuid AND id = $2::uuid
       FOR UPDATE`,
      [fixture.workspaceId, fixture.credentialId]
    );
    pendingClaim = claim(
      connector,
      role,
      fixture.jobId,
      `fresh-lease-${suffix}`,
      10
    );
    await waitForBackendLock(setup, backendPid);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await setup.query("COMMIT");

    const rows = await pendingClaim;
    const claimed = rows[0];
    assert.equal(claimed?.claimOutcome, "CLAIMED");
    assert.ok(claimed.leaseExpiresAt);
    assert.ok(
      claimed.leaseExpiresAt.getTime() - Date.now() > 9_000,
      "lease must start after the credential lock wait"
    );
  } catch (error) {
    await setup.query("ROLLBACK").catch(() => undefined);
    await pendingClaim?.catch(() => undefined);
    throw error;
  }
}

async function waitForBackendLock(
  client: Client,
  backendPid: number
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await client.query<{ readonly waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting
       FROM pg_stat_activity
       WHERE pid = $1::integer`,
      [backendPid]
    );
    if (state.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("credential claim did not reach the expected lock wait");
}

interface CanaryRow {
  readonly keyVersion: number;
  readonly usedByCredential: boolean;
  readonly ciphertext: Buffer | null;
}

async function createValidation(
  client: Client,
  keyVersion: number,
  suffix: string,
  options: {
    readonly provider?: "ARSENKIN" | "KEYS_SO";
    readonly connectorVersion?: string;
  } = {}
): Promise<ValidationFixture> {
  const [workspaceId, credentialId, jobId] = await databaseUuidV7s(client, 3);
  assert.ok(workspaceId && credentialId && jobId);
  const tenantCiphertext = Buffer.from(`tenant-secret-${suffix}`);
  const provider = options.provider ?? "KEYS_SO";
  const validationConnectorVersion =
    options.connectorVersion ?? connectorVersion;
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO public.integration_credentials (
         id, workspace_id, provider, label, mode, status, ciphertext,
         nonce, auth_tag, encrypted_data_key, data_key_nonce,
         data_key_auth_tag, key_version, capabilities, provider_meta,
         idempotency_key, request_fingerprint, fingerprint_key_version,
         material_version, version, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $5::text,
         'Broker fixture',
         'BYOK_API_KEY', 'PENDING_VERIFICATION', $3::bytea,
         decode(repeat('21', 12), 'hex'),
         decode(repeat('22', 16), 'hex'), decode('23', 'hex'),
         decode(repeat('24', 12), 'hex'),
         decode(repeat('25', 16), 'hex'), $4::integer, '[]'::jsonb,
         '{}'::jsonb, $6, decode(repeat('26', 32), 'hex'), 1, 1, 1,
         clock_timestamp()
       )`,
      [
        credentialId,
        workspaceId,
        tenantCiphertext,
        keyVersion,
        provider,
        `broker-credential:${credentialId}`
      ]
    );
    await client.query(
      `INSERT INTO public.jobs (
         id, workspace_id, type, status, stage, deduplication_key,
         idempotency_scope, input_snapshot, scope_snapshot,
         credential_mode, provider, correlation_id, version, queued_at,
         updated_at
       ) VALUES (
         $1::uuid, $2::uuid, 'INTEGRATION_CREDENTIAL_VALIDATE', 'QUEUED',
         'credential_validation_queued', $3, $4,
         jsonb_build_object(
           'kind', 'integration.credential.validation.v1',
           'credentialId', $5::uuid::text,
           'credentialMaterialVersion', 1,
           'connectorVersion', $6::text
         ),
         jsonb_build_object(
           'workspaceId', $2::uuid::text,
           'credentialId', $5::uuid::text
         ),
         'BYOK_API_KEY', $7::text, $8,
         1, clock_timestamp(),
         clock_timestamp()
       )`,
      [
        jobId,
        workspaceId,
        `integration-credential-validation:${credentialId}:1`,
        `integration-credential-validation:${credentialId}`,
        credentialId,
        validationConnectorVersion,
        provider,
        `broker-validation-${suffix}`
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  return { workspaceId, credentialId, jobId, tenantCiphertext };
}

async function verifyArsenkinSuccessMetadataRequired(
  setup: Client,
  connector: Client,
  role: string,
  keyVersion: number,
  suffix: string
): Promise<void> {
  const fixture = await createValidation(setup, keyVersion, suffix, {
    provider: "ARSENKIN",
    connectorVersion: arsenkinConnectorVersion
  });
  const claimedRows = await claim(
    connector,
    role,
    fixture.jobId,
    `arsenkin-meta-${suffix}`
  );
  const claimed = claimedRows[0];
  assert.equal(claimed?.claimOutcome, "CLAIMED");
  assert.ok(claimed.leaseToken);

  for (const invalidMetadata of [undefined, {}] as const) {
    await assert.rejects(
      finishSuccess(connector, role, claimed, invalidMetadata),
      hasSqlState("22023")
    );
  }

  const unchanged = await setup.query<{
    readonly credentialStatus: string;
    readonly jobStatus: string;
    readonly leaseToken: string;
  }>(
    `SELECT job.status::text AS "jobStatus",
            job.validation_lease_token::text AS "leaseToken",
            credential.status::text AS "credentialStatus"
     FROM public.jobs job
     JOIN public.integration_credentials credential
       ON credential.workspace_id = job.workspace_id
      AND credential.id = $2::uuid
     WHERE job.id = $1::uuid`,
    [fixture.jobId, fixture.credentialId]
  );
  assert.deepEqual(unchanged.rows[0], {
    jobStatus: "RUNNING",
    leaseToken: claimed.leaseToken,
    credentialStatus: "PENDING_VERIFICATION"
  });

  const completed = await finishSuccess(connector, role, claimed, {
    limitsTotal: 25
  });
  assert.equal(completed[0]?.jobStatus, "COMPLETED");
  const activated = await setup.query<{
    readonly credentialStatus: string;
    readonly providerMeta: unknown;
  }>(
    `SELECT status::text AS "credentialStatus",
            provider_meta AS "providerMeta"
     FROM public.integration_credentials
     WHERE workspace_id = $1::uuid AND id = $2::uuid`,
    [fixture.workspaceId, fixture.credentialId]
  );
  assert.deepEqual(activated.rows[0], {
    credentialStatus: "ACTIVE",
    providerMeta: { limitsTotal: 25 }
  });
}

async function createNonValidationJob(
  client: Client,
  suffix: string
): Promise<string> {
  const [workspaceId, jobId] = await databaseUuidV7s(client, 2);
  assert.ok(workspaceId && jobId);
  await client.query(
    `INSERT INTO public.jobs (
       id, workspace_id, type, status, idempotency_scope,
       input_snapshot, scope_snapshot, credential_mode,
       correlation_id, version, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, 'NOT_A_VALIDATION', 'QUEUED', $3,
       '{}'::jsonb, '{}'::jsonb, 'PLATFORM_INCLUDED', $4, 1,
       clock_timestamp()
     )`,
    [jobId, workspaceId, `other:${jobId}`, `other-${suffix}`]
  );
  return jobId;
}

async function verifyProviderFailureAndUtc(
  setup: Client,
  connector: Client,
  role: string,
  keyVersion: number,
  suffix: string
): Promise<void> {
  const fixture = await createValidation(setup, keyVersion, suffix);
  const claimedRows = await claim(
    connector,
    role,
    fixture.jobId,
    `rate-${suffix}`
  );
  const claimed = claimedRows[0];
  assert.equal(claimed?.claimOutcome, "CLAIMED");
  assert.ok(claimed.leaseToken);
  const finished = await asRole(connector, role, async () => {
    await connector.query("SET LOCAL TIME ZONE 'Europe/Berlin'");
    return connector.query<{
      readonly jobStatus: string;
      readonly retryAt: Date;
    }>(
      `SELECT *
       FROM public.finish_integration_credential_validation_provider_failure(
         $1::uuid, $2::text, $3::uuid, $4::integer,
         'PROVIDER_RATE_LIMITED', 'RATE_LIMITED', 30
       )`,
      [fixture.jobId, claimed.leaseOwner, claimed.leaseToken, claimed.jobVersion]
    );
  });
  assert.equal(finished.rows[0]?.jobStatus, "WAITING_RATE_LIMIT");
  const state = await setup.query<{
    readonly jobStatus: string;
    readonly credentialStatus: string;
    readonly retryAt: Date;
    readonly retryAtJson: string;
  }>(
    `SELECT job.status::text AS "jobStatus",
            credential.status::text AS "credentialStatus",
            job.retry_at AS "retryAt",
            job.error_summary ->> 'retryAt' AS "retryAtJson"
     FROM public.jobs job
     JOIN public.integration_credentials credential ON credential.id = $2::uuid
     WHERE job.id = $1::uuid`,
    [fixture.jobId, fixture.credentialId]
  );
  assert.equal(state.rows[0]?.jobStatus, "WAITING_RATE_LIMIT");
  assert.equal(state.rows[0]?.credentialStatus, "RATE_LIMITED");
  assert.equal(
    state.rows[0]?.retryAtJson,
    state.rows[0]?.retryAt.toISOString()
  );
}

async function verifyCorruptedScopes(
  setup: Client,
  connector: Client,
  role: string,
  keyVersion: number,
  suffix: string
): Promise<void> {
  const corruptions = [
    `input_snapshot = input_snapshot - 'kind'`,
    `provider = NULL`,
    `deduplication_key = NULL`
  ];
  for (const [index, corruption] of corruptions.entries()) {
    const fixture = await createValidation(
      setup,
      keyVersion,
      `${suffix}-corrupt-${index}`
    );
    await setup.query(
      `UPDATE public.jobs SET ${corruption}, updated_at = clock_timestamp()
       WHERE id = $1::uuid`,
      [fixture.jobId]
    );
    assert.deepEqual(
      await claim(
        connector,
        role,
        fixture.jobId,
        `corrupt-${index}-${suffix}`
      ),
      []
    );
    const state = await setup.query<{
      readonly status: string;
      readonly errorCode: string;
    }>(
      `SELECT status::text, error_summary ->> 'code' AS "errorCode"
       FROM public.jobs WHERE id = $1::uuid`,
      [fixture.jobId]
    );
    assert.deepEqual(state.rows[0], {
      status: "FAILED_FINAL",
      errorCode: "VALIDATION_SCOPE_INVALID"
    });
  }
}

async function verifyNullFinishInputs(
  setup: Client,
  connector: Client,
  role: string,
  keyVersion: number,
  suffix: string
): Promise<void> {
  const fixture = await createValidation(setup, keyVersion, suffix);
  const claimedRows = await claim(
    connector,
    role,
    fixture.jobId,
    `null-finish-${suffix}`
  );
  const claimed = claimedRows[0];
  assert.equal(claimed?.claimOutcome, "CLAIMED");
  assert.ok(claimed.leaseToken);
  await assert.rejects(
    asRole(connector, role, () =>
      connector.query(
        `SELECT *
         FROM public.finish_integration_credential_validation_job_failure(
           $1::uuid, $2::text, $3::uuid, $4::integer,
           NULL::text, NULL::integer
         )`,
        [
          fixture.jobId,
          claimed.leaseOwner,
          claimed.leaseToken,
          claimed.jobVersion
        ]
      )
    ),
    hasSqlState("22023")
  );
  await assert.rejects(
    asRole(connector, role, () =>
      connector.query(
        `SELECT *
         FROM public.finish_integration_credential_validation_provider_failure(
           $1::uuid, $2::text, $3::uuid, $4::integer,
           'INVALID_CREDENTIAL', NULL::text, NULL::integer
         )`,
        [
          fixture.jobId,
          claimed.leaseOwner,
          claimed.leaseToken,
          claimed.jobVersion
        ]
      )
    ),
    hasSqlState("22023")
  );
  const state = await setup.query<{
    readonly status: string;
    readonly leaseToken: string;
  }>(
    `SELECT status::text,
            validation_lease_token::text AS "leaseToken"
     FROM public.jobs WHERE id = $1::uuid`,
    [fixture.jobId]
  );
  assert.deepEqual(state.rows[0], {
    status: "RUNNING",
    leaseToken: claimed.leaseToken
  });
  await finishJobFailure(
    connector,
    role,
    fixture.jobId,
    claimed.leaseOwner,
    claimed.leaseToken,
    claimed.jobVersion,
    "CREDENTIAL_DISABLED"
  );
}

async function verifyMaterialDrift(
  setup: Client,
  connector: Client,
  role: string,
  keyVersion: number,
  suffix: string
): Promise<void> {
  const fixture = await createValidation(setup, keyVersion, suffix);
  const claimedRows = await claim(
    connector,
    role,
    fixture.jobId,
    `drift-${suffix}`
  );
  const claimed = claimedRows[0];
  assert.equal(claimed?.claimOutcome, "CLAIMED");
  await setup.query(
    `UPDATE public.integration_credentials
     SET material_version = material_version + 1,
         updated_at = clock_timestamp()
     WHERE id = $1::uuid`,
    [fixture.credentialId]
  );
  const finished = await finishSuccess(connector, role, claimed, {});
  assert.equal(finished[0]?.jobStatus, "FAILED_FINAL");
  assert.equal(finished[0]?.errorCode, "CREDENTIAL_CHANGED");
  const credential = await setup.query<{
    readonly status: string;
    readonly providerMeta: unknown;
  }>(
    `SELECT status::text, provider_meta AS "providerMeta"
     FROM public.integration_credentials WHERE id = $1::uuid`,
    [fixture.credentialId]
  );
  assert.deepEqual(credential.rows[0], {
    status: "PENDING_VERIFICATION",
    providerMeta: {}
  });
}

async function verifyTypeScriptBrokerRoundTrip(
  setup: Client,
  url: string,
  keyVersion: number,
  configuredUnusedKeyVersion: number,
  retiredUnusedKeyVersion: number,
  missingRequestedKeyVersion: number,
  missingUsedKeyVersion: number,
  canaryCiphertext: Buffer,
  configuredUnusedCiphertext: Buffer,
  suffix: string
): Promise<void> {
  const fixture = await createValidation(setup, keyVersion, suffix);
  const prisma = new PrismaService({
    databaseUrl: url,
    databasePoolMax: 1
  } as AppConfig);
  const broker = new IntegrationCredentialExecutionBrokerService(prisma);
  try {
    const canaries = await broker.executionKekCanaries([
      configuredUnusedKeyVersion,
      missingRequestedKeyVersion,
      keyVersion
    ]);
    assert.deepEqual(
      canaries
        .filter(({ keyVersion: version }) =>
          [keyVersion, configuredUnusedKeyVersion].includes(version)
        )
        .map(({ keyVersion: version, usedByCredential, encrypted }) => ({
          keyVersion: version,
          usedByCredential,
          ciphertext: encrypted?.ciphertext
        })),
      [
        {
          keyVersion,
          usedByCredential: true,
          ciphertext: canaryCiphertext
        },
        {
          keyVersion: configuredUnusedKeyVersion,
          usedByCredential: false,
          ciphertext: configuredUnusedCiphertext
        }
      ]
    );
    assert.equal(
      canaries.some(
        ({ keyVersion: version }) => version === retiredUnusedKeyVersion
      ),
      false
    );
    assert.deepEqual(
      canaries
        .filter(({ keyVersion: version }) =>
          [missingRequestedKeyVersion, missingUsedKeyVersion].includes(
            version
          )
        )
        .map(({ keyVersion: version, usedByCredential, encrypted }) => ({
          keyVersion: version,
          usedByCredential,
          encrypted
        })),
      [
        {
          keyVersion: missingRequestedKeyVersion,
          usedByCredential: false,
          encrypted: undefined
        },
        {
          keyVersion: missingUsedKeyVersion,
          usedByCredential: true,
          encrypted: undefined
        }
      ]
    );
    const pending = await broker.pendingValidationIds(500);
    assert.equal(pending.includes(fixture.jobId), true);
    const claimed = await broker.claimValidation(
      fixture.jobId,
      `typescript-${suffix}`,
      30
    );
    assert.ok(claimed);
    assert.equal(claimed.outcome, "CLAIMED");
    assert.equal(claimed.scopeState, "READY");
    assert.deepEqual(
      claimed.encryptedCredential?.ciphertext,
      fixture.tenantCiphertext
    );
    const finished = await broker.finishJobFailure(
      claimed,
      "CREDENTIAL_DISABLED"
    );
    assert.equal(finished.status, "FAILED_FINAL");
    assert.equal(finished.errorCode, "CREDENTIAL_DISABLED");
  } finally {
    await prisma.$disconnect();
  }
}

async function registerSyntheticCanary(
  client: Client,
  keyVersion: number,
  ciphertext: Buffer
): Promise<void> {
  await client.query(
    `SELECT *
     FROM public.register_integration_credential_kek_canary(
       $1::integer, $2::bytea,
       decode(repeat('31', 12), 'hex'),
       decode(repeat('32', 16), 'hex'), decode('33', 'hex'),
       decode(repeat('34', 12), 'hex'),
       decode(repeat('35', 16), 'hex')
     )`,
    [keyVersion, ciphertext]
  );
}

async function assertInvalidExecutionCanaryRequests(
  client: Client,
  role: string,
  keyVersion: number
): Promise<void> {
  const invalidRequests: readonly (readonly string[] | null)[] = [
    null,
    Array.from({ length: 129 }, (_, index) => String(index + 1)),
    ["0"],
    ["01"],
    ["not-a-version"],
    ["2147483648"],
    [String(keyVersion), String(keyVersion)]
  ];
  for (const requested of invalidRequests) {
    await assert.rejects(
      asRole(client, role, () =>
        client.query(
          `SELECT *
           FROM public.list_integration_credential_execution_kek_canaries(
             $1::text[]
           )`,
          [requested]
        )
      ),
      hasSqlState("22023")
    );
  }
  await assert.rejects(
    asRole(client, role, () =>
      client.query(
        `SELECT *
         FROM public.list_integration_credential_execution_kek_canaries(
           ARRAY[[${keyVersion}::text]]
         )`
      )
    ),
    hasSqlState("22023")
  );
}

async function assertExecutionCanaryProjectionBound(
  client: Client,
  role: string
): Promise<void> {
  await assert.rejects(
    asRole(client, role, () =>
      client.query(
        `SELECT *
         FROM public.list_integration_credential_execution_kek_canaries(
           $1::text[]
         )`,
        [Array.from({ length: 128 }, (_, index) => String(index + 1))]
      )
    ),
    hasSqlState("22023")
  );
}

async function claim(
  client: Client,
  role: string,
  validationId: string,
  leaseOwner: string,
  leaseSeconds = 30
): Promise<readonly (ClaimRow & { readonly leaseOwner: string })[]> {
  const result = await asRole(client, role, () =>
    client.query<ClaimRow>(
      `SELECT *
       FROM public.claim_integration_credential_validation(
         $1::uuid, $2::text, $3::integer
       )`,
      [validationId, leaseOwner, leaseSeconds]
    )
  );
  return result.rows.map((row) => ({ ...row, leaseOwner }));
}

async function finishJobFailure(
  client: Client,
  role: string,
  validationId: string,
  leaseOwner: string,
  leaseToken: string,
  jobVersion: number,
  errorCode: string
): Promise<readonly unknown[]> {
  const result = await asRole(client, role, () =>
    client.query(
      `SELECT *
       FROM public.finish_integration_credential_validation_job_failure(
         $1::uuid, $2::text, $3::uuid, $4::integer, $5::text, NULL
       )`,
      [validationId, leaseOwner, leaseToken, jobVersion, errorCode]
    )
  );
  return result.rows;
}

async function finishSuccess(
  client: Client,
  role: string,
  claimRow: ClaimRow & { readonly leaseOwner: string },
  providerMeta: unknown
): Promise<readonly (ClaimRow & { readonly errorCode: string | null })[]> {
  assert.ok(claimRow.leaseToken);
  const result = await asRole(client, role, () =>
    client.query<ClaimRow & { readonly errorCode: string | null }>(
      `SELECT *
       FROM public.finish_integration_credential_validation_success(
         $1::uuid, $2::text, $3::uuid, $4::integer, $5::text, $6::jsonb
       )`,
      [
        claimRow.validationId,
        claimRow.leaseOwner,
        claimRow.leaseToken,
        claimRow.jobVersion,
        claimRow.connectorVersion,
        providerMeta === undefined ? null : JSON.stringify(providerMeta)
      ]
    )
  );
  return result.rows;
}

async function assertRestrictedTableAndManagementAccess(
  client: Client,
  role: string,
  keyVersion: number
): Promise<void> {
  for (const query of [
    "SELECT * FROM public.jobs LIMIT 1",
    "SELECT * FROM public.integration_credentials LIMIT 1",
    "SELECT * FROM public.integration_credential_kek_canaries LIMIT 1",
    "SELECT * FROM public.list_integration_credential_key_versions()",
    `SELECT * FROM public.register_integration_credential_kek_canary(
       ${keyVersion}, decode('01', 'hex'), decode(repeat('01', 12), 'hex'),
       decode(repeat('01', 16), 'hex'), decode('01', 'hex'),
       decode(repeat('01', 12), 'hex'), decode(repeat('01', 16), 'hex')
     )`
  ]) {
    await assert.rejects(
      asRole(client, role, () => client.query(query)),
      hasSqlState("42501")
    );
  }
}

async function assertPublicBrokerBypassClosed(
  client: Client,
  role: string
): Promise<void> {
  const checks = await client.query<{ readonly allowed: boolean }>(
    `SELECT has_function_privilege($1, function_oid, 'EXECUTE') AS allowed
     FROM unnest(ARRAY[
       'public.list_integration_credential_execution_kek_canaries(text[])'::regprocedure::oid,
       'public.list_due_integration_credential_validations(integer)'::regprocedure::oid,
       'public.claim_integration_credential_validation(uuid,text,integer)'::regprocedure::oid,
       'public.finish_integration_credential_validation_job_failure(uuid,text,uuid,integer,text,integer)'::regprocedure::oid,
       'public.finish_integration_credential_validation_provider_failure(uuid,text,uuid,integer,text,text,integer)'::regprocedure::oid,
       'public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)'::regprocedure::oid
     ]) AS function_oid`,
    [role]
  );
  assert.equal(checks.rows.length, 6);
  assert.equal(checks.rows.every(({ allowed }) => !allowed), true);
  const tables = await client.query<{
    readonly jobs: boolean;
    readonly credentials: boolean;
    readonly canaries: boolean;
  }>(
    `SELECT has_table_privilege($1, 'public.jobs', 'SELECT') AS jobs,
            has_table_privilege(
              $1, 'public.integration_credentials', 'SELECT'
            ) AS credentials,
            has_table_privilege(
              $1, 'public.integration_credential_kek_canaries', 'SELECT'
            ) AS canaries`,
    [role]
  );
  assert.deepEqual(tables.rows[0], {
    jobs: false,
    credentials: false,
    canaries: false
  });
}

async function grantConnectorBroker(
  client: Client,
  role: string
): Promise<void> {
  await client.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  for (const signature of [
    "public.list_integration_credential_execution_kek_canaries(text[])",
    "public.list_due_integration_credential_validations(integer)",
    "public.claim_integration_credential_validation(uuid,text,integer)",
    "public.finish_integration_credential_validation_job_failure(uuid,text,uuid,integer,text,integer)",
    "public.finish_integration_credential_validation_provider_failure(uuid,text,uuid,integer,text,text,integer)",
    "public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)"
  ]) {
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${signature} TO "${role}"`
    );
  }
}

async function asRole<Result>(
  client: Client,
  role: string,
  callback: () => Promise<Result>
): Promise<Result> {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE "${role}"`);
    await client.query("SET LOCAL search_path = pg_temp, public");
    const result = await callback();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function connectedClient(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function assertPostgres18(client: Client): Promise<void> {
  const result = await client.query<{
    readonly server_version_num: string;
  }>(
    "SHOW server_version_num"
  );
  assert.ok(Number(result.rows[0]?.server_version_num ?? 0) >= 180_000);
}

async function databaseUuidV7(client: Client): Promise<string> {
  const result = await client.query<{ readonly id: string }>(
    "SELECT pg_catalog.uuidv7()::text AS id"
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
    `SELECT pg_catalog.uuidv7()::text AS id
     FROM generate_series(1, $1::integer)`,
    [count]
  );
  return result.rows.map(({ id }) => id);
}

function hasSqlState(expected: string): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === expected;
}
