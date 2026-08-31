import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const adminUrl = process.env.SERVICE_DATABASE_ROLE_TEST_ADMIN_URL;
const psqlPath = process.env.SERVICE_DATABASE_ROLE_TEST_PSQL ?? "psql";
const pnpmPath = process.env.SERVICE_DATABASE_ROLE_TEST_PNPM ?? "pnpm";
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const roleProvisionerPath = fileURLToPath(
  new URL(
    "../postgres/roles/provision-service-database-roles.sh",
    import.meta.url
  )
);
const runtimeProvisionerPath = fileURLToPath(
  new URL(
    "../postgres/permissions/provision-service-runtime-role.sh",
    import.meta.url
  )
);
const extensionPermissionPath = fileURLToPath(
  new URL(
    "../postgres/permissions/seo-extension-runtime.sql",
    import.meta.url
  )
);
const connectorProvisionerPath = fileURLToPath(
  new URL(
    "../postgres/permissions/provision-jobs-connector-role.sh",
    import.meta.url
  )
);
const connectorPermissionPath = fileURLToPath(
  new URL("../postgres/permissions/jobs-connector.sql", import.meta.url)
);
const postgresEntrypointPath = fileURLToPath(
  new URL("../postgres/config/start-postgres.sh", import.meta.url)
);

const mappings = [
  {
    database: "platform_db",
    owner: "platform_owner",
    ownerSecret: "PLATFORM_DATABASE_OWNER_PASSWORD",
    runtime: "platform_runtime",
    runtimeSecret: "PLATFORM_DATABASE_PASSWORD",
    packageName: "@seo-platform/backend-core-api"
  },
  {
    database: "seo_db",
    owner: "seo_owner",
    ownerSecret: "SEO_DATABASE_OWNER_PASSWORD",
    runtime: "seo_runtime",
    runtimeSecret: "SEO_DATABASE_PASSWORD",
    packageName: "@seo-platform/backend-core-seo"
  },
  {
    database: "jobs_db",
    owner: "jobs_owner",
    ownerSecret: "JOBS_DATABASE_OWNER_PASSWORD",
    runtime: "jobs_runtime",
    runtimeSecret: "JOBS_DATABASE_PASSWORD",
    packageName: "@seo-platform/backend-execution"
  },
  {
    database: "realtime_db",
    owner: "realtime_owner",
    ownerSecret: "REALTIME_DATABASE_OWNER_PASSWORD",
    runtime: "realtime_runtime",
    runtimeSecret: "REALTIME_DATABASE_PASSWORD",
    packageName: "@seo-platform/backend-core-realtime"
  }
];

const isolatedJobsRuntimes = Object.freeze([
  Object.freeze({
    runtime: "jobs_rank_runtime",
    runtimeSecret: "JOBS_RANK_DATABASE_PASSWORD"
  }),
  Object.freeze({
    runtime: "jobs_auth_email_runtime",
    runtimeSecret: "JOBS_AUTH_EMAIL_DATABASE_PASSWORD"
  })
]);

const rankBoundaryFixture = Object.freeze({
  workspaceId: "00000000-0000-7000-8000-000000000101",
  projectId: "00000000-0000-7000-8000-000000000102",
  actorId: "00000000-0000-7000-8000-000000000103",
  trackingContextId: "00000000-0000-7000-8000-000000000104",
  validationJobId: "00000000-0000-7000-8000-000000000105",
  credentialId: "00000000-0000-7000-8000-000000000106",
  bindingId: "00000000-0000-7000-8000-000000000107",
  routeId: "00000000-0000-7000-8000-000000000108",
  estimateId: "00000000-0000-7000-8000-000000000109",
  manualJobId: "00000000-0000-7000-8000-000000000110",
  manualItemId: "00000000-0000-7000-8000-000000000111",
  unrelatedJobId: "00000000-0000-7000-8000-000000000112",
  unrelatedItemId: "00000000-0000-7000-8000-000000000113"
});

test(
  "PostgreSQL 18 isolates migration owners, service runtimes and connector",
  { skip: adminUrl === undefined, timeout: 240_000 },
  async () => {
    assert.ok(adminUrl);
    const admin = postgresEnvironment(adminUrl);
    assert.equal(admin.PGDATABASE, "postgres");
    await assertFreshPostgres18Administrator(admin);

    const passwords = Object.fromEntries(
      [
        ...mappings.flatMap((mapping) => [
          mapping.ownerSecret,
          mapping.runtimeSecret
        ]),
        "JOBS_RANK_DATABASE_PASSWORD",
        "JOBS_AUTH_EMAIL_DATABASE_PASSWORD",
        "JOBS_CONNECTOR_DATABASE_PASSWORD"
      ].map((secretName) => [
        secretName,
        `${secretName.toLowerCase().replaceAll("_", "-")}-${randomBytes(24).toString("base64url")}`
      ])
    );
    assert.equal(new Set(Object.values(passwords)).size, 11);

    let originalHba;
    let hbaPath;
    let hbaReplaced = false;
    try {
      const bootstrap = await runProcess(
        "/bin/sh",
        [roleProvisionerPath],
        {
          ...admin,
          ...passwords
        }
      );
      assert.equal(
        bootstrap.code,
        0,
        `role bootstrap failed:\n${bootstrap.stdout}\n${bootstrap.stderr}`
      );
      for (const password of Object.values(passwords)) {
        assert.doesNotMatch(
          `${bootstrap.stdout}\n${bootstrap.stderr}`,
          new RegExp(escapeRegExp(password), "u")
        );
      }

      await Promise.all(
        mappings.map((mapping) =>
          deployMigrations(admin, mapping, passwords[mapping.ownerSecret])
        )
      );

      const extensionPermissions = await runPsql(
        { ...admin, PGDATABASE: "seo_db" },
        ["--file", extensionPermissionPath]
      );
      assert.equal(
        extensionPermissions.code,
        0,
        `pg_trgm ACL failed:\n${extensionPermissions.stdout}\n${extensionPermissions.stderr}`
      );

      await Promise.all(
        mappings.map((mapping) =>
          provisionRuntime(
            admin,
            mapping,
            passwords[mapping.ownerSecret]
          )
        )
      );

      const connector = await runProcess(
        "/bin/sh",
        [connectorProvisionerPath],
        {
          ...admin,
          PGDATABASE: "jobs_db",
          JOBS_CONNECTOR_DATABASE_USER: "jobs_connector",
          JOBS_CONNECTOR_DATABASE_PASSWORD:
            passwords.JOBS_CONNECTOR_DATABASE_PASSWORD
        }
      );
      assert.equal(
        connector.code,
        0,
        `connector provisioning failed:\n${connector.stdout}\n${connector.stderr}`
      );
      assert.doesNotMatch(
        `${connector.stdout}\n${connector.stderr}`,
        new RegExp(
          escapeRegExp(passwords.JOBS_CONNECTOR_DATABASE_PASSWORD),
          "u"
        )
      );

      await assertRoleCatalog(admin);
      await createFutureRuntimeProbes(admin, passwords);
      await assertRuntimeCrudAndBoundaries(admin, passwords);
      await assertOwnerBoundaries(admin, passwords);
      await assertPublicAndRoutineBoundaries(admin);
      await assertOwnerAuditFailsClosed(admin, passwords);

      hbaPath = await checkedPsql(admin, "SHOW hba_file");
      originalHba = await readFile(hbaPath, "utf8");
      const generatedHba = await runProcess(
        "/bin/sh",
        [postgresEntrypointPath, "--print-hba"],
        {
          ...process.env,
          POSTGRES_USER: admin.PGUSER,
          JOBS_CONNECTOR_DATABASE_USER: "jobs_connector"
        }
      );
      assert.equal(generatedHba.code, 0, generatedHba.stderr);
      await writeFile(hbaPath, generatedHba.stdout, {
        encoding: "utf8",
        mode: 0o600
      });
      hbaReplaced = true;
      assert.equal(await checkedPsql(admin, "SELECT pg_reload_conf()"), "t");
      assert.equal(
        await checkedPsql(
          admin,
          "SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL"
        ),
        "0"
      );

      await assertLiveHbaBoundaries(admin, passwords);
    } finally {
      if (hbaReplaced && hbaPath && originalHba !== undefined) {
        await writeFile(hbaPath, originalHba, {
          encoding: "utf8",
          mode: 0o600
        });
        await checkedPsql(admin, "SELECT pg_reload_conf()");
      }
      await cleanup(admin);
    }
  }
);

async function assertFreshPostgres18Administrator(admin) {
  const version = Number(await checkedPsql(admin, "SHOW server_version_num"));
  assert.ok(version >= 180_000 && version < 190_000);
  assert.equal(
    await checkedPsql(
      admin,
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"
    ),
    "t"
  );
  assert.equal(
    await checkedPsql(
      admin,
      `SELECT count(*)
       FROM pg_database
       WHERE datname IN (
         'platform_db', 'seo_db', 'jobs_db', 'realtime_db'
       )`
    ),
    "0",
    "the opt-in URL must point to a fresh disposable cluster"
  );
  assert.equal(
    await checkedPsql(
      admin,
      `SELECT count(*)
       FROM pg_roles
       WHERE rolname ~ '^(platform|seo|jobs|realtime)_(owner|runtime)$'
          OR rolname IN (
            'jobs_rank_runtime', 'jobs_auth_email_runtime', 'jobs_connector'
          )`
    ),
    "0",
    "the opt-in cluster must not contain canonical service roles"
  );
}

async function deployMigrations(admin, mapping, password) {
  const databaseUrl =
    `postgresql://${mapping.owner}:${password}` +
    `@127.0.0.1:${admin.PGPORT}/${mapping.database}`;
  const result = await runProcess(
    pnpmPath,
    ["--filter", mapping.packageName, "prisma:migrate:deploy"],
    {
      ...process.env,
      DATABASE_URL: databaseUrl
    },
    { cwd: repositoryRoot }
  );
  assert.equal(
    result.code,
    0,
    `${mapping.database} migration failed:\n${result.stdout}\n${result.stderr}`
  );
  assert.match(result.stdout, /All migrations have been successfully applied/u);
}

async function provisionRuntime(admin, mapping, ownerPassword) {
  const result = await runProcess(
    "/bin/sh",
    [runtimeProvisionerPath],
    {
      ...admin,
      PGHOST: "127.0.0.1",
      PGDATABASE: mapping.database,
      PGUSER: mapping.owner,
      PGPASSWORD: ownerPassword
    }
  );
  assert.equal(
    result.code,
    0,
    `${mapping.database} runtime ACL failed:\n${result.stdout}\n${result.stderr}`
  );
}

async function assertRoleCatalog(admin) {
  assert.equal(
    await checkedPsql(
      admin,
      `SELECT count(*)
       FROM pg_roles
       WHERE rolname IN (
         'platform_owner', 'platform_runtime',
         'seo_owner', 'seo_runtime',
         'jobs_owner', 'jobs_runtime', 'jobs_rank_runtime',
         'jobs_auth_email_runtime',
         'realtime_owner', 'realtime_runtime',
         'jobs_connector'
       )
         AND rolcanlogin
         AND NOT rolsuper
         AND NOT rolcreatedb
         AND NOT rolcreaterole
         AND NOT rolinherit
         AND NOT rolreplication
         AND NOT rolbypassrls`
    ),
    "11"
  );
  assert.equal(
    await checkedPsql(
      admin,
      `SELECT count(*)
       FROM pg_auth_members membership
       WHERE membership.member IN (
         SELECT oid FROM pg_roles
         WHERE rolname IN (
           'platform_owner', 'platform_runtime',
           'seo_owner', 'seo_runtime',
           'jobs_owner', 'jobs_runtime', 'jobs_rank_runtime',
           'jobs_auth_email_runtime',
           'realtime_owner', 'realtime_runtime',
           'jobs_connector'
         )
       ) OR membership.roleid IN (
         SELECT oid FROM pg_roles
         WHERE rolname IN (
           'platform_owner', 'platform_runtime',
           'seo_owner', 'seo_runtime',
           'jobs_owner', 'jobs_runtime', 'jobs_rank_runtime',
           'jobs_auth_email_runtime',
           'realtime_owner', 'realtime_runtime',
           'jobs_connector'
         )
       )`
    ),
    "0"
  );
  for (const mapping of mappings) {
    assert.equal(
      await checkedPsql(
        admin,
        `SELECT count(*)
         FROM pg_shdepend
         WHERE refclassid = 'pg_authid'::regclass
           AND refobjid = '${mapping.runtime}'::regrole
           AND deptype = 'o'`
      ),
      "0"
    );
  }
  assert.equal(
    await checkedPsql(
      admin,
      `SELECT count(*)
       FROM pg_shdepend
       WHERE refclassid = 'pg_authid'::regclass
         AND refobjid = 'jobs_rank_runtime'::regrole
         AND deptype = 'o'`
    ),
    "0"
  );
  assert.equal(
    await checkedPsql(
      admin,
      `SELECT count(*)
       FROM pg_shdepend
       WHERE refclassid = 'pg_authid'::regclass
         AND refobjid = 'jobs_auth_email_runtime'::regrole
         AND deptype = 'o'`
    ),
    "0"
  );
}

async function createFutureRuntimeProbes(admin, passwords) {
  for (const mapping of mappings) {
    const environment = roleEnvironment(
      admin,
      mapping.owner,
      mapping.database,
      passwords[mapping.ownerSecret]
    );
    let constraint = "";
    if (mapping.database === "seo_db") {
      constraint =
        ", flags JSONB NOT NULL DEFAULT '[]'::jsonb " +
        "CHECK (public.rank_data_quality_flags_valid(flags))";
    } else if (mapping.database === "jobs_db") {
      constraint = `, CHECK (public.manual_rank_job_state_is_coherent(
        'PREPARING'::public."JobStatus",
        'PENDING'::public."RankManifestSealState",
        NULL::public."RankCheckFinalStatus"
      ))`;
    }
    await checkedPsql(
      environment,
      `CREATE TABLE public.runtime_permission_probe (
         serial_id BIGSERIAL PRIMARY KEY,
         id UUID NOT NULL DEFAULT uuidv7(),
         value TEXT NOT NULL
         ${constraint}
       );
       CREATE FUNCTION public.runtime_future_private()
       RETURNS integer
       LANGUAGE sql
       IMMUTABLE
       SET search_path = pg_catalog
       AS 'SELECT 1';`
    );
  }
}

async function assertRuntimeCrudAndBoundaries(admin, passwords) {
  for (const mapping of mappings) {
    const runtime = roleEnvironment(
      admin,
      mapping.runtime,
      mapping.database,
      passwords[mapping.runtimeSecret]
    );
    assert.equal(
      await checkedPsql(
        runtime,
        `INSERT INTO public.runtime_permission_probe(value)
           VALUES ('initial')
           RETURNING substring(id::text, 15, 1);
         UPDATE public.runtime_permission_probe
           SET value = 'updated' WHERE value = 'initial';
         SELECT count(*) FROM public.runtime_permission_probe
           WHERE value = 'updated';
         DELETE FROM public.runtime_permission_probe WHERE value = 'updated';`
      ),
      "7\n1"
    );

    for (const deniedSql of [
      "CREATE TABLE public.runtime_forbidden(id integer)",
      "CREATE SCHEMA runtime_forbidden",
      "CREATE EXTENSION hstore",
      "CREATE ROLE runtime_forbidden",
      "SELECT * FROM public._prisma_migrations",
      "TRUNCATE public.runtime_permission_probe",
      "ALTER TABLE public.runtime_permission_probe ADD COLUMN leaked integer",
      `SET ROLE ${mapping.owner}`,
      "SELECT public.runtime_future_private()"
    ]) {
      await assertPsqlDenied(runtime, deniedSql);
    }

    const otherDatabase =
      mapping.database === "platform_db" ? "seo_db" : "platform_db";
    await assertConnectionDenied(
      { ...runtime, PGDATABASE: otherDatabase },
      /permission denied for database|pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
    );
  }

  const seoRuntime = roleEnvironment(
    admin,
    "seo_runtime",
    "seo_db",
    passwords.SEO_DATABASE_PASSWORD
  );
  assert.equal(await checkedPsql(seoRuntime, "SELECT similarity('abc', 'abc')"), "1");
  assert.equal(
    await checkedPsql(
      seoRuntime,
      "SELECT public.project_workspace_rekey_allowed('{}'::jsonb, '{}'::jsonb)"
    ),
    "f"
  );
  const jobsRuntime = roleEnvironment(
    admin,
    "jobs_runtime",
    "jobs_db",
    passwords.JOBS_DATABASE_PASSWORD
  );
  assert.equal(
    await checkedPsql(
      jobsRuntime,
      "SELECT count(*) FROM public.list_integration_credential_key_versions()"
    ),
    "0"
  );
  await assertPsqlDenied(
    jobsRuntime,
    "SELECT count(*) FROM public.rank_provider_request_intents"
  );
  await assertPsqlDenied(
    jobsRuntime,
    "SELECT count(*) FROM public.auth_email_delivery_attempts"
  );

  const rankRuntime = roleEnvironment(
    admin,
    "jobs_rank_runtime",
    "jobs_db",
    passwords.JOBS_RANK_DATABASE_PASSWORD
  );
  assert.equal(
    await checkedPsql(
      rankRuntime,
      "SELECT count(*) FROM public.rank_provider_request_intents"
    ),
    "0"
  );

  for (const forbiddenTable of [
    "uploads",
    "semantic_imports",
    "semantic_import_staging_rows",
    "semantic_import_validated_rows",
    "outbox_events",
    "integration_credential_kek_canaries",
    "runtime_permission_probe"
  ]) {
    await assertPsqlDenied(
      rankRuntime,
      `SELECT count(*) FROM public.${forbiddenTable}`
    );
  }

  assert.equal(
    await checkedPsql(
      { ...admin, PGDATABASE: "jobs_db" },
      `SELECT concat_ws(',',
         has_table_privilege(
           'jobs_runtime',
           'public.rank_provider_request_intents',
           'SELECT'
         ),
         has_table_privilege(
           'jobs_runtime',
           'public.rank_provider_request_intents',
           'INSERT'
         ),
         has_table_privilege(
           'jobs_rank_runtime',
           'public.rank_provider_request_intents',
           'SELECT'
         ),
         has_table_privilege(
           'jobs_rank_runtime',
           'public.rank_provider_request_intents',
           'INSERT'
         ),
         has_table_privilege(
           'jobs_rank_runtime',
           'public.rank_provider_request_intents',
           'UPDATE'
         ),
         has_table_privilege(
           'jobs_rank_runtime',
           'public.rank_provider_request_intents',
           'DELETE'
         ),
         has_table_privilege(
           'jobs_rank_runtime',
           'public.rank_provider_request_intents',
           'TRUNCATE'
         )
       )`
    ),
    "f,f,t,t,f,f,f"
  );

  assert.equal(
    await checkedPsql(
      { ...admin, PGDATABASE: "jobs_db" },
      `SELECT count(*)
       FROM pg_default_acl default_acl
       CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) privilege
       WHERE privilege.grantee = 'jobs_rank_runtime'::regrole`
    ),
    "0"
  );

  assert.equal(
    await checkedPsql(
      { ...admin, PGDATABASE: "jobs_db" },
      `SELECT count(*)
       FROM pg_class sequence
       JOIN pg_namespace namespace ON namespace.oid = sequence.relnamespace
       WHERE namespace.nspname = 'public'
         AND sequence.relkind = 'S'
         AND (
           has_sequence_privilege(
             'jobs_rank_runtime', sequence.oid, 'USAGE'
           )
           OR has_sequence_privilege(
             'jobs_rank_runtime', sequence.oid, 'SELECT'
           )
           OR has_sequence_privilege(
             'jobs_rank_runtime', sequence.oid, 'UPDATE'
           )
         )`
    ),
    "0"
  );

  const authEmailRuntime = roleEnvironment(
    admin,
    "jobs_auth_email_runtime",
    "jobs_db",
    passwords.JOBS_AUTH_EMAIL_DATABASE_PASSWORD
  );
  const authEmailSourceEventId = "00000000-0000-7000-8000-000000000201";
  assert.equal(
    await checkedPsql(
      authEmailRuntime,
      `INSERT INTO public.auth_email_delivery_attempts (
         source_event_id, event_type, source_event_hash, updated_at
       ) VALUES (
         '${authEmailSourceEventId}'::uuid,
         'identity.email-verification.requested.v1',
         decode(repeat('21', 32), 'hex'), clock_timestamp()
       ) RETURNING status`
    ),
    "PENDING"
  );
  assert.equal(
    await checkedPsql(
      authEmailRuntime,
      `UPDATE public.auth_email_delivery_attempts
       SET status = 'SENDING', attempts = attempts + 1,
           lease_owner = 'postgres-boundary-test', lease_token = uuidv7(),
           lease_expires_at = clock_timestamp() + interval '1 minute',
           version = version + 1, updated_at = clock_timestamp()
       WHERE source_event_id = '${authEmailSourceEventId}'::uuid
       RETURNING status`
    ),
    "SENDING"
  );
  await assertPsqlDenied(
    authEmailRuntime,
    `DELETE FROM public.auth_email_delivery_attempts
     WHERE source_event_id = '${authEmailSourceEventId}'::uuid`
  );
  for (const forbiddenTable of [
    "jobs",
    "job_items",
    "rank_provider_request_intents",
    "outbox_events",
    "integration_credentials",
    "runtime_permission_probe",
    "_prisma_migrations"
  ]) {
    await assertPsqlDenied(
      authEmailRuntime,
      `SELECT count(*) FROM public.${forbiddenTable}`
    );
  }
  assert.equal(
    await checkedPsql(
      { ...admin, PGDATABASE: "jobs_db" },
      `SELECT concat_ws(',',
         has_table_privilege(
           'jobs_auth_email_runtime',
           'public.auth_email_delivery_attempts',
           'SELECT'
         ),
         has_table_privilege(
           'jobs_auth_email_runtime',
           'public.auth_email_delivery_attempts',
           'INSERT'
         ),
         has_table_privilege(
           'jobs_auth_email_runtime',
           'public.auth_email_delivery_attempts',
           'UPDATE'
         ),
         has_table_privilege(
           'jobs_auth_email_runtime',
           'public.auth_email_delivery_attempts',
           'DELETE'
         ),
         has_table_privilege(
           'jobs_auth_email_runtime',
           'public.auth_email_delivery_attempts',
           'TRUNCATE'
         )
       )`
    ),
    "t,t,t,f,f"
  );

  assert.equal(
    await checkedPsql(
      { ...admin, PGDATABASE: "jobs_db" },
      `SELECT string_agg(attribute.attname, ',' ORDER BY attribute.attname)
       FROM pg_attribute attribute
       WHERE attribute.attrelid = 'public.job_items'::regclass
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND has_column_privilege(
           'jobs_rank_runtime', attribute.attrelid, attribute.attnum, 'UPDATE'
         )`
    ),
    "actual_cost_micro,attempt,error,output_reference,provider_request_id,retry_at,status,updated_at"
  );

  for (const lockOnlyTable of [
    "integration_credentials",
    "project_connector_bindings",
    "project_connector_routes"
  ]) {
    assert.equal(
      await checkedPsql(
        { ...admin, PGDATABASE: "jobs_db" },
        `SELECT has_column_privilege(
           'jobs_rank_runtime',
           'public.${lockOnlyTable}',
           'id',
           'UPDATE'
         )`
      ),
      "t"
    );
    assert.equal(
      await checkedPsql(
        { ...admin, PGDATABASE: "jobs_db" },
        `SELECT count(*)
         FROM pg_attribute attribute
         WHERE attribute.attrelid = 'public.${lockOnlyTable}'::regclass
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND attribute.attname <> 'id'
           AND has_column_privilege(
             'jobs_rank_runtime',
             attribute.attrelid,
             attribute.attnum,
             'UPDATE'
           )`
      ),
      "0"
    );
  }

  await assertRankRuntimeDomainBoundary(admin, passwords);
}

async function assertRankRuntimeDomainBoundary(admin, passwords) {
  const fixture = rankBoundaryFixture;
  const owner = roleEnvironment(
    admin,
    "jobs_owner",
    "jobs_db",
    passwords.JOBS_DATABASE_OWNER_PASSWORD
  );
  await checkedPsql(
    owner,
    `BEGIN;
     INSERT INTO public.jobs (
       id, workspace_id, project_id, type, status, stage,
       idempotency_scope, input_snapshot, scope_snapshot,
       credential_mode, provider, correlation_id, version, finished_at,
       updated_at
     ) VALUES (
       '${fixture.validationJobId}'::uuid,
       '${fixture.workspaceId}'::uuid,
       '${fixture.projectId}'::uuid,
       'INTEGRATION_CREDENTIAL_VALIDATE', 'COMPLETED', 'FINISHED',
       'rank-boundary-validation', jsonb_build_object(
         'kind', 'integration.credential.validation.v1',
         'credentialId', '${fixture.credentialId}',
         'credentialMaterialVersion', 1,
         'connectorVersion', 'rank-boundary@1'
       ), '{}'::jsonb, 'BYOK_API_KEY', 'ARSENKIN',
       'rank-boundary-validation', 1,
       '2026-07-30 00:00:00+00'::timestamptz, clock_timestamp()
     );
     INSERT INTO public.integration_credentials (
       id, workspace_id, provider, label, mode, status, ciphertext,
       nonce, auth_tag, encrypted_data_key, data_key_nonce,
       data_key_auth_tag, key_version, capabilities, idempotency_key,
       request_fingerprint, fingerprint_key_version, material_version,
       verified_at, version, updated_at
     ) VALUES (
       '${fixture.credentialId}'::uuid,
       '${fixture.workspaceId}'::uuid,
       'ARSENKIN', 'Rank boundary fixture', 'BYOK_API_KEY', 'ACTIVE',
       decode('01', 'hex'), decode(repeat('02', 12), 'hex'),
       decode(repeat('03', 16), 'hex'), decode('04', 'hex'),
       decode(repeat('05', 12), 'hex'),
       decode(repeat('06', 16), 'hex'), 1,
       '["SERP_RANK_TRACKING"]'::jsonb, 'rank-boundary-credential',
       decode(repeat('07', 32), 'hex'), 1, 1,
       '2026-07-30 00:00:00+00'::timestamptz, 1, clock_timestamp()
     );
     INSERT INTO public.project_connector_bindings (
       id, workspace_id, project_id, capability, enabled,
       created_by, updated_by, version, updated_at
     ) VALUES (
       '${fixture.bindingId}'::uuid,
       '${fixture.workspaceId}'::uuid,
       '${fixture.projectId}'::uuid,
       'SERP_RANK_TRACKING', TRUE, '${fixture.actorId}'::uuid,
       '${fixture.actorId}'::uuid, 1, clock_timestamp()
     );
     INSERT INTO public.project_connector_routes (
       id, workspace_id, project_id, binding_id, position,
       source_kind, credential_id, updated_at
     ) VALUES (
       '${fixture.routeId}'::uuid,
       '${fixture.workspaceId}'::uuid,
       '${fixture.projectId}'::uuid,
       '${fixture.bindingId}'::uuid, 0, 'WORKSPACE_CREDENTIAL',
       '${fixture.credentialId}'::uuid, clock_timestamp()
     );
     INSERT INTO public.rank_estimates (
       id, workspace_id, project_id, actor_id, tracking_context_id,
       idempotency_scope, idempotency_key, request_hash,
       project_version, project_domain_hash, context_version,
       configuration_version, configuration_hash, semantic_scope_hash,
       scope_hash, provider, credential_mode, provider_policy_version,
       keyword_count, provider_task_count, minimum_submit_request_count,
       minimum_check_request_count, minimum_get_request_count, blockers,
       response_snapshot, execution_snapshot, execution_snapshot_hash,
       calculated_at, expires_at
     ) VALUES (
       '${fixture.estimateId}'::uuid,
       '${fixture.workspaceId}'::uuid,
       '${fixture.projectId}'::uuid,
       '${fixture.actorId}'::uuid,
       '${fixture.trackingContextId}'::uuid,
       'rank-boundary-estimate', 'rank-boundary-estimate',
       decode(repeat('11', 32), 'hex'), 1,
       decode(repeat('12', 32), 'hex'), 1, 1,
       decode(repeat('13', 32), 'hex'),
       decode(repeat('14', 32), 'hex'),
       decode(repeat('15', 32), 'hex'),
       'ARSENKIN', 'BYOK_API_KEY', 'manual-arsenkin-positions@1.0.0',
       1, 1, 1, 1, 1, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
       decode(repeat('16', 32), 'hex'),
       '2026-07-30 00:00:00+00'::timestamptz,
       '2026-07-30 00:05:00+00'::timestamptz
     );
     INSERT INTO public.jobs (
       id, workspace_id, project_id, type, status, stage, actor_id,
       deduplication_key, idempotency_scope, idempotency_key,
       request_hash, input_snapshot, scope_snapshot, progress_current,
       progress_total, progress_unit, estimated_cost_micro, currency,
       credential_mode, provider, max_attempts, correlation_id, version,
       updated_at
     ) VALUES (
       '${fixture.manualJobId}'::uuid,
       '${fixture.workspaceId}'::uuid,
       '${fixture.projectId}'::uuid,
       'MANUAL_RANK_CHECK', 'PREPARING', 'PREPARING_SCOPE',
       '${fixture.actorId}'::uuid, 'rank-boundary-manual',
       'rank-boundary-manual', 'rank-boundary-manual',
       decode(repeat('11', 32), 'hex'), '{}'::jsonb, '{}'::jsonb,
       0, 1, 'KEYWORD', 0, 'RUB', 'BYOK_API_KEY', 'ARSENKIN', 3,
       'rank-boundary-manual', 1, clock_timestamp()
     );
     INSERT INTO public.rank_job_runs (
       job_id, workspace_id, project_id, estimate_id,
       tracking_context_id, project_domain, project_status,
       project_version, manifest_command, manifest_command_hash,
       updated_at
     ) VALUES (
       '${fixture.manualJobId}'::uuid,
       '${fixture.workspaceId}'::uuid,
       '${fixture.projectId}'::uuid,
       '${fixture.estimateId}'::uuid,
       '${fixture.trackingContextId}'::uuid,
       'example.test', 'ACTIVE', 1, '{}'::jsonb,
       decode(repeat('17', 32), 'hex'), clock_timestamp()
     );
     INSERT INTO public.jobs (
       id, workspace_id, project_id, type, status, idempotency_scope,
       input_snapshot, scope_snapshot, credential_mode, correlation_id,
       updated_at
     ) VALUES (
       '${fixture.unrelatedJobId}'::uuid,
       '${fixture.workspaceId}'::uuid,
       '${fixture.projectId}'::uuid,
       'SITE_AUDIT', 'DRAFT', 'rank-boundary-unrelated', '{}'::jsonb,
       '{}'::jsonb, 'PLATFORM_INCLUDED', 'rank-boundary-unrelated',
       clock_timestamp()
     );
     INSERT INTO public.job_items (
       id, workspace_id, project_id, job_id, sequence, status,
       input_reference, updated_at
     ) VALUES
       (
         '${fixture.manualItemId}'::uuid,
         '${fixture.workspaceId}'::uuid,
         '${fixture.projectId}'::uuid,
         '${fixture.manualJobId}'::uuid, 0, 'PENDING', '{}'::jsonb,
         clock_timestamp()
       ),
       (
         '${fixture.unrelatedItemId}'::uuid,
         '${fixture.workspaceId}'::uuid,
         '${fixture.projectId}'::uuid,
         '${fixture.unrelatedJobId}'::uuid, 0, 'PENDING', '{}'::jsonb,
         clock_timestamp()
       );
     COMMIT;`
  );

  const rank = roleEnvironment(
    admin,
    "jobs_rank_runtime",
    "jobs_db",
    passwords.JOBS_RANK_DATABASE_PASSWORD
  );
  assert.equal(
    await checkedPsql(
      rank,
      "SELECT string_agg(type, ',' ORDER BY type) FROM public.jobs"
    ),
    "INTEGRATION_CREDENTIAL_VALIDATE,MANUAL_RANK_CHECK"
  );
  assert.equal(
    await checkedPsql(rank, "SELECT count(*) FROM public.job_items"),
    "1"
  );
  assert.equal(
    await checkedPsql(
      rank,
      `WITH hidden AS (
         SELECT id FROM public.jobs
         WHERE id = '${fixture.unrelatedJobId}'::uuid FOR UPDATE
       ) SELECT count(*) FROM hidden`
    ),
    "0"
  );
  assert.equal(
    await checkedPsql(
      rank,
      `BEGIN;
       SELECT id FROM public.jobs
       WHERE id = '${fixture.validationJobId}'::uuid FOR UPDATE;
       ROLLBACK;`
    ),
    fixture.validationJobId
  );
  assert.equal(
    await checkedPsql(
      rank,
      `SELECT concat_ws(',',
         (SELECT count(*) FROM public.project_connector_bindings),
         (SELECT count(*) FROM public.project_connector_routes),
         (SELECT count(id) FROM public.integration_credentials))`
    ),
    "1,1,1"
  );
  assert.equal(
    await checkedPsql(
      { ...admin, PGDATABASE: "jobs_db" },
      `SELECT string_agg(attribute.attname, ',' ORDER BY attribute.attname)
       FROM pg_attribute attribute
       WHERE attribute.attrelid = 'public.integration_credentials'::regclass
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND has_column_privilege(
           'jobs_rank_runtime', attribute.attrelid, attribute.attnum, 'SELECT'
         )`
    ),
    "capabilities,deleted_at,id,last_success_at,material_version,mode,provider,status,verified_at,version,workspace_id"
  );
  await assertPsqlDenied(
    rank,
    `SELECT ciphertext FROM public.integration_credentials
     WHERE id = '${fixture.credentialId}'::uuid`
  );

  const validationUpdate = await runPsql(rank, [
    "--command",
    `UPDATE public.jobs SET version = version + 1,
       updated_at = clock_timestamp()
     WHERE id = '${fixture.validationJobId}'::uuid`
  ]);
  assert.notEqual(validationUpdate.code, 0);
  assert.match(
    validationUpdate.stderr,
    /cannot update non-rank jobs|violates row-level security/u
  );

  await assertPsqlDenied(
    rank,
    `UPDATE public.job_items SET id = id
     WHERE id = '${fixture.manualItemId}'::uuid`
  );

  for (const [table, id] of [
    ["integration_credentials", fixture.credentialId],
    ["project_connector_bindings", fixture.bindingId],
    ["project_connector_routes", fixture.routeId]
  ]) {
    const noOpUpdate = await runPsql(rank, [
      "--command",
      `UPDATE public.${table} SET id = id WHERE id = '${id}'::uuid`
    ]);
    assert.notEqual(noOpUpdate.code, 0);
    assert.match(noOpUpdate.stderr, /cannot update lock-only rows/u);
  }

  assert.equal(
    await checkedPsql(
      rank,
      `UPDATE public.jobs
       SET version = version + 1, updated_at = clock_timestamp()
       WHERE id = '${fixture.manualJobId}'::uuid
       RETURNING version`
    ),
    "2"
  );
  await assertPsqlDenied(
    rank,
    `UPDATE public.jobs SET priority = priority
     WHERE id = '${fixture.manualJobId}'::uuid`
  );

  const generic = roleEnvironment(
    admin,
    "jobs_runtime",
    "jobs_db",
    passwords.JOBS_DATABASE_PASSWORD
  );
  assert.equal(
    await checkedPsql(
      generic,
      `UPDATE public.jobs SET priority = priority + 1
       WHERE id = '${fixture.unrelatedJobId}'::uuid
       RETURNING priority`
    ),
    "101"
  );
  assert.equal(
    await checkedPsql(
      generic,
      `SELECT concat_ws(',',
         (SELECT count(*) FROM public.jobs),
         (SELECT octet_length(ciphertext)
          FROM public.integration_credentials
          WHERE id = '${fixture.credentialId}'::uuid))`
    ),
    "3,1"
  );
}

async function assertOwnerBoundaries(admin, passwords) {
  for (const mapping of mappings) {
    const owner = roleEnvironment(
      admin,
      mapping.owner,
      mapping.database,
      passwords[mapping.ownerSecret]
    );
    await checkedPsql(
      owner,
      "CREATE TABLE public.owner_migration_probe(id integer); DROP TABLE public.owner_migration_probe"
    );
    const otherDatabase =
      mapping.database === "platform_db" ? "seo_db" : "platform_db";
    await assertConnectionDenied(
      { ...owner, PGDATABASE: otherDatabase },
      /permission denied for database|pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
    );
  }

  const rankRuntime = roleEnvironment(
    admin,
    "jobs_rank_runtime",
    "jobs_db",
    passwords.JOBS_RANK_DATABASE_PASSWORD
  );
  assert.equal(await checkedPsql(rankRuntime, "SELECT current_database()"), "jobs_db");
  await assertConnectionDenied(
    { ...rankRuntime, PGDATABASE: "platform_db" },
    /permission denied for database|pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
  );

  const authEmailRuntime = roleEnvironment(
    admin,
    "jobs_auth_email_runtime",
    "jobs_db",
    passwords.JOBS_AUTH_EMAIL_DATABASE_PASSWORD
  );
  assert.equal(
    await checkedPsql(authEmailRuntime, "SELECT current_database()"),
    "jobs_db"
  );
  await assertConnectionDenied(
    { ...authEmailRuntime, PGDATABASE: "platform_db" },
    /permission denied for database|pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
  );

}

async function assertPublicAndRoutineBoundaries(admin) {
  for (const mapping of mappings) {
    const databaseAdmin = { ...admin, PGDATABASE: mapping.database };
    assert.equal(
      await checkedPsql(
        databaseAdmin,
        `SELECT count(*)
         FROM pg_namespace namespace
         CROSS JOIN LATERAL aclexplode(
           COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
         ) privilege
         WHERE namespace.nspname = 'public'
           AND privilege.grantee = 0`
      ),
      "0"
    );
    assert.equal(
      await checkedPsql(
        databaseAdmin,
        `SELECT count(*)
         FROM pg_proc routine
         JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
         CROSS JOIN LATERAL aclexplode(
           COALESCE(routine.proacl, acldefault('f', routine.proowner))
         ) privilege
         WHERE namespace.nspname = 'public'
           AND privilege.grantee = 0`
      ),
      "0"
    );
  }
  const connectorPermissionSql = await readFile(
    connectorPermissionPath,
    "utf8"
  );
  const expectedConnectorRoutines = [
    ...connectorPermissionSql.replace(/\s+/gu, " ").matchAll(
      /GRANT EXECUTE ON FUNCTION (public\.[a-z0-9_]+\([^)]*\)) TO %I/giu
    )
  ]
    .map((match) => normalizeRoutineSignature(match[1]))
    .sort();
  assert.ok(expectedConnectorRoutines.length >= 8);
  assert.equal(
    new Set(expectedConnectorRoutines).size,
    expectedConnectorRoutines.length
  );
  const actualConnectorRoutines = (
    await checkedPsql(
      { ...admin, PGDATABASE: "jobs_db" },
      `SELECT format(
                '%I.%I(%s)',
                namespace.nspname,
                routine.proname,
                oidvectortypes(routine.proargtypes)
              )
       FROM pg_proc routine
       JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
       WHERE namespace.nspname = 'public'
         AND has_function_privilege('jobs_connector', routine.oid, 'EXECUTE')
       ORDER BY 1`
    )
  )
    .split("\n")
    .filter(Boolean)
    .map(normalizeRoutineSignature)
    .sort();
  assert.deepEqual(actualConnectorRoutines, expectedConnectorRoutines);
}

async function assertOwnerAuditFailsClosed(admin, passwords) {
  const platformOwner = roleEnvironment(
    admin,
    "platform_owner",
    "platform_db",
    passwords.PLATFORM_DATABASE_OWNER_PASSWORD
  );
  await checkedPsql(platformOwner, "CREATE SCHEMA unexpected_owner_schema");
  const schemaRejected = await runProcess(
    "/bin/sh",
    [runtimeProvisionerPath],
    platformOwner
  );
  assert.notEqual(schemaRejected.code, 0);
  assert.match(
    `${schemaRejected.stdout}\n${schemaRejected.stderr}`,
    /unexpected non-system schema/u
  );
  await checkedPsql(platformOwner, "DROP SCHEMA unexpected_owner_schema");
  await provisionRuntime(
    admin,
    mappings[0],
    passwords.PLATFORM_DATABASE_OWNER_PASSWORD
  );

  await checkedPsql(
    { ...admin, PGDATABASE: "realtime_db" },
    `CREATE FUNCTION public.foreign_owner_probe()
     RETURNS integer LANGUAGE sql AS 'SELECT 1'`
  );
  const realtimeOwner = roleEnvironment(
    admin,
    "realtime_owner",
    "realtime_db",
    passwords.REALTIME_DATABASE_OWNER_PASSWORD
  );
  const ownerRejected = await runProcess(
    "/bin/sh",
    [runtimeProvisionerPath],
    realtimeOwner
  );
  assert.notEqual(ownerRejected.code, 0);
  assert.match(
    `${ownerRejected.stdout}\n${ownerRejected.stderr}`,
    /public objects must belong exclusively/u
  );
  await checkedPsql(
    { ...admin, PGDATABASE: "realtime_db" },
    "DROP FUNCTION public.foreign_owner_probe()"
  );
  await provisionRuntime(
    admin,
    mappings[3],
    passwords.REALTIME_DATABASE_OWNER_PASSWORD
  );
}

async function assertLiveHbaBoundaries(admin, passwords) {
  for (const mapping of mappings) {
    for (const [role, secretName] of [
      [mapping.owner, mapping.ownerSecret],
      [mapping.runtime, mapping.runtimeSecret]
    ]) {
      const own = roleEnvironment(
        admin,
        role,
        mapping.database,
        passwords[secretName]
      );
      assert.equal(
        await checkedPsql(own, "SELECT current_database()"),
        mapping.database
      );
      const otherDatabase =
        mapping.database === "platform_db" ? "seo_db" : "platform_db";
      await assertConnectionDenied(
        { ...own, PGDATABASE: otherDatabase },
        /pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
      );
    }
  }

  for (const isolatedRuntime of isolatedJobsRuntimes) {
    const own = roleEnvironment(
      admin,
      isolatedRuntime.runtime,
      "jobs_db",
      passwords[isolatedRuntime.runtimeSecret]
    );
    assert.equal(await checkedPsql(own, "SELECT current_database()"), "jobs_db");
    await assertConnectionDenied(
      { ...own, PGDATABASE: "platform_db" },
      /pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
    );
  }

  const staleRole = "platform_runtime_stale";
  const stalePassword = `stale-${randomBytes(24).toString("base64url")}`;
  await checkedPsql(
    admin,
    `CREATE ROLE ${staleRole}
       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
       NOINHERIT NOREPLICATION NOBYPASSRLS;
     GRANT CONNECT ON DATABASE platform_db TO ${staleRole}`
  );
  await setRolePassword(admin, staleRole, stalePassword);
  await assertConnectionDenied(
    roleEnvironment(
      admin,
      staleRole,
      "platform_db",
      stalePassword
    ),
    /pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
  );
  await checkedPsql(
    admin,
    `REVOKE CONNECT ON DATABASE platform_db FROM ${staleRole}`
  );
  await checkedPsql(admin, `DROP ROLE ${staleRole}`);

  const replication = await runPsql(
    {
      ...roleEnvironment(
        admin,
        "platform_runtime",
        "platform_db",
        passwords.PLATFORM_DATABASE_PASSWORD
      ),
      PGDATABASE: ""
    },
    [
      "--dbname",
      `postgresql://platform_runtime@127.0.0.1:${admin.PGPORT}/postgres?replication=database`,
      "--command",
      "IDENTIFY_SYSTEM"
    ]
  );
  assert.notEqual(replication.code, 0);
  assert.match(
    replication.stderr,
    /pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
  );
}

function roleEnvironment(admin, role, database, password) {
  return {
    ...admin,
    PGHOST: "127.0.0.1",
    PGDATABASE: database,
    PGUSER: role,
    PGPASSWORD: password,
    PGOPTIONS: ""
  };
}

function normalizeRoutineSignature(signature) {
  return signature
    .replace(/\s+/gu, "")
    .toLowerCase()
    .replaceAll("timestampwithtimezone", "timestamptz");
}

async function assertPsqlDenied(environment, sql) {
  const denied = await runPsql(environment, ["--command", sql]);
  assert.notEqual(denied.code, 0, `unexpectedly allowed: ${sql}`);
  assert.match(
    denied.stderr,
    /permission denied|must be owner|not allowed to|does not exist/u
  );
}

async function assertConnectionDenied(environment, expectedError) {
  const denied = await runPsql(environment, ["--command", "SELECT 1"]);
  assert.notEqual(denied.code, 0);
  assert.match(denied.stderr, expectedError);
}

async function setRolePassword(admin, role, password) {
  const result = await runProcess(
    psqlPath,
    [
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=1",
      `--set=role_name=${role}`,
      "--command=SET password_encryption = 'scram-sha-256'",
      "--command=\\password :\"role_name\""
    ],
    admin,
    { input: `${password}\n${password}\n` }
  );
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    new RegExp(escapeRegExp(password), "u")
  );
}

async function cleanup(admin) {
  for (const database of [
    "platform_db",
    "seo_db",
    "jobs_db",
    "realtime_db"
  ]) {
    if (
      (await checkedPsql(
        admin,
        `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${database}')`
      )) === "t"
    ) {
      await checkedPsql(admin, `DROP DATABASE ${database} WITH (FORCE)`);
    }
  }
  for (const role of [
    "jobs_connector",
    "platform_runtime_stale",
    "platform_runtime",
    "platform_owner",
    "seo_runtime",
    "seo_owner",
    "jobs_runtime",
    "jobs_rank_runtime",
    "jobs_auth_email_runtime",
    "jobs_owner",
    "realtime_runtime",
    "realtime_owner"
  ]) {
    if (
      (await checkedPsql(
        admin,
        `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}')`
      )) === "t"
    ) {
      await checkedPsql(admin, `DROP ROLE ${role}`);
    }
  }
}

function postgresEnvironment(value) {
  const url = new URL(value);
  assert.ok(url.protocol === "postgres:" || url.protocol === "postgresql:");
  const configuredPsqlDirectory = psqlPath.includes("/")
    ? dirname(psqlPath)
    : undefined;
  const inheritedPath = process.env.PATH ?? "/usr/bin:/bin";
  return {
    ...process.env,
    PATH: configuredPsqlDirectory
      ? `${configuredPsqlDirectory}${delimiter}${inheritedPath}`
      : inheritedPath,
    PGHOST: decodeURIComponent(url.searchParams.get("host") ?? url.hostname),
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//u, "")),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "5",
    ...(url.searchParams.has("sslmode")
      ? { PGSSLMODE: url.searchParams.get("sslmode") }
      : {})
  };
}

async function checkedPsql(environment, sql) {
  const result = await runPsql(environment, ["--command", sql]);
  assert.equal(
    result.code,
    0,
    `psql failed:\n${result.stdout}\n${result.stderr}`
  );
  return result.stdout.trim();
}

function runPsql(environment, args) {
  return runProcess(
    psqlPath,
    [
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=1",
      "--tuples-only",
      "--no-align",
      "--quiet",
      ...args
    ],
    environment
  );
}

function runProcess(command, args, environment, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: environment,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
