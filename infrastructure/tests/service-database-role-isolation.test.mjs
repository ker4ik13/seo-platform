import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);
const envUrl = new URL("../../.env.example", import.meta.url);
const entrypointUrl = new URL(
  "../postgres/config/start-postgres.sh",
  import.meta.url
);
const roleBootstrapSqlUrl = new URL(
  "../postgres/roles/bootstrap-service-database-roles.sql",
  import.meta.url
);
const roleProvisionerUrl = new URL(
  "../postgres/roles/provision-service-database-roles.sh",
  import.meta.url
);
const runtimeSqlUrl = new URL(
  "../postgres/permissions/service-runtime.sql",
  import.meta.url
);
const rankRuntimeBoundaryMigrationUrl = new URL(
  "../../backend-execution/prisma/migrations/20260730120100_rank_runtime_database_boundary/migration.sql",
  import.meta.url
);
const extensionSqlUrl = new URL(
  "../postgres/permissions/seo-extension-runtime.sql",
  import.meta.url
);

const mappings = [
  {
    database: "platform_db",
    owner: "platform_owner",
    ownerSecret: "PLATFORM_DATABASE_OWNER_PASSWORD",
    runtime: "platform_runtime",
    runtimeSecret: "PLATFORM_DATABASE_PASSWORD"
  },
  {
    database: "seo_db",
    owner: "seo_owner",
    ownerSecret: "SEO_DATABASE_OWNER_PASSWORD",
    runtime: "seo_runtime",
    runtimeSecret: "SEO_DATABASE_PASSWORD"
  },
  {
    database: "jobs_db",
    owner: "jobs_owner",
    ownerSecret: "JOBS_DATABASE_OWNER_PASSWORD",
    runtime: "jobs_runtime",
    runtimeSecret: "JOBS_DATABASE_PASSWORD"
  },
  {
    database: "realtime_db",
    owner: "realtime_owner",
    ownerSecret: "REALTIME_DATABASE_OWNER_PASSWORD",
    runtime: "realtime_runtime",
    runtimeSecret: "REALTIME_DATABASE_PASSWORD"
  }
];

const rankRuntime = {
  database: "jobs_db",
  runtime: "jobs_rank_runtime",
  runtimeSecret: "JOBS_RANK_DATABASE_PASSWORD"
};

const authEmailRuntime = {
  database: "jobs_db",
  runtime: "jobs_auth_email_runtime",
  runtimeSecret: "JOBS_AUTH_EMAIL_DATABASE_PASSWORD"
};

const databasePasswordPlaceholders = Object.freeze([
  `replace-${"a".repeat(32)}`,
  `CHANGE-${"b".repeat(32)}`,
  `ChangeMe${"c".repeat(32)}`,
  `Example${"d".repeat(32)}`,
  `DUMMY-${"e".repeat(32)}`,
  `Placeholder${"f".repeat(32)}`,
  `TEST-${"g".repeat(32)}`,
  `Your-${"h".repeat(32)}`,
  `YOUR_${"i".repeat(32)}`
]);

function compact(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function serviceBlock(compose, serviceName) {
  const startMarker = `\n  ${serviceName}:\n`;
  const start = compose.indexOf(startMarker);
  assert.ok(start >= 0, `Missing Compose service ${serviceName}`);
  const contentStart = start + startMarker.length;
  const next = compose.slice(contentStart).search(/^  [a-z0-9][a-z0-9-]+:\n/mu);
  return next < 0
    ? compose.slice(contentStart)
    : compose.slice(contentStart, contentStart + next);
}

test("Compose splits migration owners from fixed runtime roles", async () => {
  const compose = await readFile(composeUrl, "utf8");

  const migrationServices = [
    ["core-api-migrate", mappings[0]],
    ["core-seo-migrate", mappings[1]],
    ["execution-migrate", mappings[2]],
    ["core-realtime-migrate", mappings[3]]
  ];
  for (const [serviceName, mapping] of migrationServices) {
    const block = serviceBlock(compose, serviceName);
    assert.match(
      block,
      new RegExp(
        `DATABASE_URL: postgresql://${mapping.owner}:\\$\\{${mapping.ownerSecret}:\\?[^}]+\\}@postgres:5432/${mapping.database}`,
        "u"
      )
    );
    assert.doesNotMatch(block, /POSTGRES_(?:USER|PASSWORD)/u);
    assert.match(
      block,
      /service-database-roles:\s+condition: service_completed_successfully/u
    );
  }

  const directRuntimeServices = [
    ["backend-core", mappings[0], "PLATFORM_DATABASE_URL"],
    ["backend-core", mappings[1], "SEO_DATABASE_URL"],
    ["backend-core", mappings[3], "REALTIME_DATABASE_URL"],
    ["backend-execution", mappings[2], "EXECUTION_HTTP_DATABASE_URL"],
    ["backend-execution", rankRuntime, "EXECUTION_RANK_DATABASE_URL"],
    ["backend-execution", authEmailRuntime, "EXECUTION_AUTH_EMAIL_DATABASE_URL"]
  ];
  for (const [serviceName, mapping, environmentKey] of directRuntimeServices) {
    const block = serviceBlock(compose, serviceName);
    assert.match(
      block,
      new RegExp(
        `${environmentKey}: postgresql://${mapping.runtime}:\\$\\{${mapping.runtimeSecret}:\\?[^}]+\\}@postgres:5432/${mapping.database}`,
        "u"
      )
    );
    assert.doesNotMatch(block, /POSTGRES_(?:USER|PASSWORD)/u);
  }

  assert.match(
    compose,
    /x-jobs-runtime-env:[\s\S]*?DATABASE_URL: postgresql:\/\/jobs_runtime:\$\{JOBS_DATABASE_PASSWORD:\?[^}]+\}@postgres:5432\/jobs_db/u
  );

  const roleProvisioner = serviceBlock(compose, "service-database-roles");
  assert.match(
    roleProvisioner,
    /JOBS_RANK_DATABASE_PASSWORD: \$\{JOBS_RANK_DATABASE_PASSWORD:\?JOBS_RANK_DATABASE_PASSWORD is required\}/u
  );
  assert.match(
    roleProvisioner,
    /JOBS_AUTH_EMAIL_DATABASE_PASSWORD: \$\{JOBS_AUTH_EMAIL_DATABASE_PASSWORD:\?JOBS_AUTH_EMAIL_DATABASE_PASSWORD is required\}/u
  );

  for (const serviceName of ["backend-execution"]) {
    const block = serviceBlock(compose, serviceName);
    assert.doesNotMatch(block, /POSTGRES_(?:USER|PASSWORD)/u);
    assert.match(
      block,
      /jobs-runtime-db-permissions:\s+condition: service_completed_successfully/u
    );
  }

  const connector = serviceBlock(compose, "backend-execution");
  assert.match(connector, /postgresql:\/\/jobs_connector:/u);
  assert.doesNotMatch(connector, /POSTGRES_(?:USER|PASSWORD)/u);

  assert.doesNotMatch(
    compose,
    /DATABASE_URL: postgresql:\/\/\$\{POSTGRES_USER\}/u
  );
  assert.doesNotMatch(compose, /DB_USER: \$\{POSTGRES_USER\}/u);
});

test("bootstrap and post-migration provisioners are secret-safe and fail closed", async () => {
  const [
    bootstrapSql,
    provisioner,
    runtimeSql,
    rankRuntimeBoundaryMigration,
    extensionSql,
    env
  ] =
    await Promise.all([
      readFile(roleBootstrapSqlUrl, "utf8"),
      readFile(roleProvisionerUrl, "utf8"),
      readFile(runtimeSqlUrl, "utf8"),
      readFile(rankRuntimeBoundaryMigrationUrl, "utf8"),
      readFile(extensionSqlUrl, "utf8"),
      readFile(envUrl, "utf8")
    ]);
  const normalizedRuntimeSql = compact(runtimeSql);

  assert.doesNotMatch(bootstrapSql, /\bPASSWORD\b/u);
  assert.match(provisioner, /unset PLATFORM_DATABASE_OWNER_PASSWORD/u);
  assert.match(provisioner, /unset JOBS_RANK_DATABASE_PASSWORD/u);
  assert.match(provisioner, /unset JOBS_AUTH_EMAIL_DATABASE_PASSWORD/u);
  assert.match(provisioner, /service database passwords must be URL-safe/u);
  assert.match(provisioner, /service database passwords must be pairwise distinct/u);
  assert.match(provisioner, /--command='\\password :"role_name"'/u);
  assert.match(
    provisioner,
    /printf '%s\\n%s\\n' "\$role_password" "\$role_password" \|/u
  );
  assert.doesNotMatch(provisioner, /--command=.*DATABASE_.*PASSWORD/u);

  for (const mapping of mappings) {
    assert.match(bootstrapSql, new RegExp(`'${mapping.owner}'`, "u"));
    assert.match(bootstrapSql, new RegExp(`'${mapping.runtime}'`, "u"));
    assert.match(env, new RegExp(`^${mapping.ownerSecret}=`, "mu"));
    assert.match(env, new RegExp(`^${mapping.runtimeSecret}=`, "mu"));
  }
  assert.match(bootstrapSql, /'jobs_rank_runtime'/u);
  assert.match(env, /^JOBS_RANK_DATABASE_PASSWORD=/mu);
  assert.match(
    provisioner,
    /set_role_password jobs_rank_runtime "\$jobs_rank_runtime_password"/u
  );
  assert.match(bootstrapSql, /'jobs_auth_email_runtime'/u);
  assert.match(env, /^JOBS_AUTH_EMAIL_DATABASE_PASSWORD=/mu);
  assert.match(
    provisioner,
    /set_role_password jobs_auth_email_runtime "\$jobs_auth_email_runtime_password"/u
  );
  assert.doesNotMatch(bootstrapSql, /directus/u);
  assert.doesNotMatch(env, /^DIRECTUS_/mu);
  assert.match(
    bootstrapSql,
    /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/u
  );
  assert.match(bootstrapSql, /member = service_role_id\s+OR roleid = service_role_id/u);

  assert.match(normalizedRuntimeSql, /BEGIN; SELECT CASE current_database\(\)/u);
  assert.match(normalizedRuntimeSql, /COMMIT;$/u);
  assert.match(
    normalizedRuntimeSql,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I\.%I TO %I/u
  );
  assert.match(
    normalizedRuntimeSql,
    /GRANT USAGE, SELECT ON SEQUENCE %I\.%I TO %I/u
  );
  assert.match(normalizedRuntimeSql, /relation\.relname <> '_prisma_migrations'/u);
  assert.match(normalizedRuntimeSql, /runtime service role retained DDL privileges/u);
  assert.match(normalizedRuntimeSql, /must not access Prisma migration history/u);
  assert.match(
    normalizedRuntimeSql,
    /relation\.relname IN \( 'rank_provider_request_intents', 'auth_email_delivery_attempts' \)/u
  );
  assert.match(
    normalizedRuntimeSql,
    /GRANT SELECT, INSERT ON TABLE public\.rank_provider_request_intents TO %I/u
  );
  assert.match(
    normalizedRuntimeSql,
    /generic jobs runtime must not access rank provider request intents/u
  );
  assert.match(
    normalizedRuntimeSql,
    /rank runtime must have only SELECT and INSERT on provider request intents/u
  );
  assert.match(
    normalizedRuntimeSql,
    /GRANT SELECT, INSERT, UPDATE ON TABLE public\.auth_email_delivery_attempts TO %I/u
  );
  assert.match(
    normalizedRuntimeSql,
    /generic jobs runtime must not access auth email delivery attempts/u
  );
  assert.match(
    normalizedRuntimeSql,
    /auth email runtime must have only SELECT, INSERT and UPDATE on delivery attempts/u
  );
  assert.match(
    normalizedRuntimeSql,
    /auth email runtime must not access other jobs tables/u
  );
  const rankTableGrants = [...normalizedRuntimeSql.matchAll(
    /'GRANT ([^']+) ON TABLE public\.([a-z_]+) TO %I', :'rank_runtime_role'/gu
  )]
    .map((match) => `${match[2]}:${match[1]?.replace(/\s+/gu, " ")}`)
    .sort();
  assert.deepEqual(rankTableGrants, [
    "integration_credentials:SELECT ( id, workspace_id, provider, mode, status, capabilities, material_version, version, verified_at, last_success_at, deleted_at )",
    "integration_credentials:UPDATE (id)",
    "job_items:SELECT, INSERT",
    "job_items:UPDATE ( status, provider_request_id, output_reference, actual_cost_micro, error, attempt, retry_at, updated_at )",
    "jobs:SELECT",
    "jobs:UPDATE ( status, stage, progress_current, attempt, error_summary, result_summary, version, queued_at, started_at, finished_at, lease_owner, lease_expires_at, retry_at, updated_at )",
    "project_connector_bindings:SELECT",
    "project_connector_bindings:UPDATE (id)",
    "project_connector_routes:SELECT",
    "project_connector_routes:UPDATE (id)",
    "rank_connector_executions:SELECT, INSERT",
    "rank_estimates:SELECT",
    "rank_execution_grant_attempts:SELECT, INSERT, UPDATE",
    "rank_job_runs:SELECT, UPDATE",
    "rank_provider_request_intents:SELECT, INSERT"
  ]);
  for (const forbiddenTable of [
    "uploads",
    "semantic_imports",
    "semantic_import_staging_rows",
    "semantic_import_validated_rows",
    "outbox_events",
    "integration_credential_kek_canaries"
  ]) {
    assert.equal(
      rankTableGrants.some((grant) => grant.startsWith(`${forbiddenTable}:`)),
      false
    );
  }
  assert.doesNotMatch(
    normalizedRuntimeSql,
    /GRANT USAGE, SELECT ON SEQUENCE [^']+ TO %I', [^']*:'rank_runtime_role'/u
  );
  assert.doesNotMatch(
    normalizedRuntimeSql,
    /ALTER DEFAULT PRIVILEGES[^']+ GRANT [^']+ TO %I', :'expected_owner', :'rank_runtime_role'/u
  );
  assert.doesNotMatch(
    rankTableGrants.join("\n"),
    /ciphertext|encrypted_data_key|nonce|auth_tag|data_key_/u
  );
  assert.doesNotMatch(normalizedRuntimeSql, /GRANT (?:CREATE|TEMPORARY|TRUNCATE|REFERENCES|TRIGGER)/u);
  assert.doesNotMatch(normalizedRuntimeSql, /GRANT ALL/u);
  assert.match(
    normalizedRuntimeSql,
    /public\.list_integration_credential_key_versions\(\)/u
  );
  assert.match(
    normalizedRuntimeSql,
    /public\.register_integration_credential_kek_canary/u
  );
  assert.match(
    normalizedRuntimeSql,
    /public\.project_workspace_rekey_allowed\(jsonb,jsonb\)/u
  );

  const normalizedBoundaryMigration = compact(rankRuntimeBoundaryMigration);
  for (const table of [
    "jobs",
    "job_items",
    "project_connector_bindings",
    "project_connector_routes",
    "integration_credentials"
  ]) {
    assert.match(
      normalizedBoundaryMigration,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "u")
    );
  }
  assert.equal(
    normalizedBoundaryMigration.match(
      /USING \(current_user = 'jobs_runtime'\) WITH CHECK \(current_user = 'jobs_runtime'\)/gu
    )?.length,
    5
  );
  assert.doesNotMatch(
    normalizedBoundaryMigration,
    /current_user <> 'jobs_rank_runtime'/u
  );
  assert.match(
    normalizedBoundaryMigration,
    /current_user = 'jobs_rank_runtime' AND "type" IN \( 'MANUAL_RANK_CHECK', 'INTEGRATION_CREDENTIAL_VALIDATE' \)/u
  );
  assert.match(
    normalizedBoundaryMigration,
    /CREATE POLICY "jobs_rank_runtime_update"[\s\S]*WITH CHECK \( current_user = 'jobs_rank_runtime' AND "type" = 'MANUAL_RANK_CHECK' \)/u
  );
  assert.match(
    normalizedBoundaryMigration,
    /"capability" = 'SERP_RANK_TRACKING'/u
  );
  assert.match(
    normalizedBoundaryMigration,
    /CREATE FUNCTION public\.reject_jobs_rank_runtime_id_update\(\)[\s\S]*IF current_user = 'jobs_rank_runtime' OR session_user = 'jobs_rank_runtime' THEN RAISE EXCEPTION 'jobs_rank_runtime cannot update lock-only rows'/u
  );
  for (const table of [
    "job_items",
    "integration_credentials",
    "project_connector_bindings",
    "project_connector_routes"
  ]) {
    assert.match(
      normalizedBoundaryMigration,
      new RegExp(`BEFORE UPDATE ON public\\.${table}`, "u")
    );
  }
  assert.match(
    normalizedBoundaryMigration,
    /CREATE FUNCTION public\.reject_jobs_rank_runtime_non_rank_job_update\(\)[\s\S]*current_user = 'jobs_rank_runtime' OR session_user = 'jobs_rank_runtime'[\s\S]*OLD\."type" <> 'MANUAL_RANK_CHECK'/u
  );
  assert.match(
    normalizedBoundaryMigration,
    /REVOKE ALL ON FUNCTION public\.reject_jobs_rank_runtime_id_update\(\) FROM PUBLIC/u
  );
  assert.doesNotMatch(
    normalizedBoundaryMigration,
    /TO jobs_rank_runtime|'jobs_rank_runtime'::regrole|FROM pg_roles/u
  );

  assert.match(extensionSql, /extension_record\.extname = 'pg_trgm'/u);
  assert.match(extensionSql, /REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC/u);
  assert.match(extensionSql, /GRANT EXECUTE ON FUNCTION %s TO seo_runtime/u);
  assert.match(extensionSql, /acl\.grantee = 0/u);
});

test("PostgreSQL startup rejects known password placeholders and unsafe bootstrap passwords without exposing values", async () => {
  const roleProvisionerPath = fileURLToPath(roleProvisionerUrl);
  const entrypointPath = fileURLToPath(entrypointUrl);

  for (const placeholder of databasePasswordPlaceholders) {
    const environment = serviceDatabasePasswordEnvironment();
    environment.JOBS_AUTH_EMAIL_DATABASE_PASSWORD = placeholder;
    const failure = await runProcess(
      "/bin/sh",
      [roleProvisionerPath],
      environment
    );

    assert.notEqual(failure.code, 0);
    assert.equal(failure.signal, null);
    assert.equal(failure.stdout, "");
    assert.equal(
      failure.stderr,
      "service database passwords must not use an example placeholder\n"
    );
    assert.equal(failure.stderr.includes(placeholder), false);
  }

  const invalidBootstrapPasswords = [
    ...databasePasswordPlaceholders.map((value) => ({
      value,
      message: "POSTGRES_PASSWORD must not use an example placeholder\n"
    })),
    {
      value: "too-short",
      message: "POSTGRES_PASSWORD must contain 32..512 characters\n"
    },
    {
      value: "z".repeat(513),
      message: "POSTGRES_PASSWORD must contain 32..512 characters\n"
    },
    {
      value: `${"k".repeat(32)}\nunsafe`,
      message: "POSTGRES_PASSWORD must not contain control characters\n"
    }
  ];

  for (const { value, message } of invalidBootstrapPasswords) {
    const failure = await runProcess(
      "/bin/sh",
      [entrypointPath],
      {
        ...process.env,
        POSTGRES_USER: "cluster_bootstrap",
        POSTGRES_PASSWORD: value,
        JOBS_CONNECTOR_DATABASE_USER: "jobs_connector"
      }
    );

    assert.notEqual(failure.code, 0);
    assert.equal(failure.signal, null);
    assert.equal(failure.stdout, "");
    assert.equal(failure.stderr, message);
    assert.equal(failure.stderr.includes(value), false);
  }
});

test("generated HBA permits only exact own-database roles before family rejects", async () => {
  const generated = await runProcess(
    "/bin/sh",
    [fileURLToPath(entrypointUrl), "--print-hba"],
    {
      ...process.env,
      POSTGRES_USER: "cluster_bootstrap",
      JOBS_CONNECTOR_DATABASE_USER: "jobs_connector"
    }
  );
  assert.equal(generated.code, 0, generated.stderr);

  const localFamilyReject = generated.stdout.search(
    /^local\s+all\s+\/\^\(platform\|seo\|jobs\|realtime\)_\(owner\|runtime\)\(_\[a-z0-9_\]\+\)\?\$\s+reject$/mu
  );
  const hostFamilyReject = generated.stdout.search(
    /^host\s+all\s+\/\^\(platform\|seo\|jobs\|realtime\)_\(owner\|runtime\)\(_\[a-z0-9_\]\+\)\?\$\s+all\s+reject$/mu
  );
  const localGeneral = generated.stdout.search(/^local\s+all\s+all\s+trust$/mu);
  const hostGeneral = generated.stdout.search(
    /^host\s+all\s+all\s+all\s+scram-sha-256$/mu
  );
  assert.ok(localFamilyReject >= 0);
  assert.ok(hostFamilyReject >= 0);
  assert.ok(localGeneral > localFamilyReject);
  assert.ok(hostGeneral > hostFamilyReject);

  for (const mapping of mappings) {
    const localAllow = generated.stdout.search(
      new RegExp(
        `^local\\s+${mapping.database}\\s+"${mapping.owner}"\\s+scram-sha-256$`,
        "mu"
      )
    );
    const localRuntimeAllow = generated.stdout.search(
      new RegExp(
        `^local\\s+${mapping.database}\\s+"${mapping.runtime}"\\s+scram-sha-256$`,
        "mu"
      )
    );
    const hostAllow = generated.stdout.search(
      new RegExp(
        `^host\\s+${mapping.database}\\s+"${mapping.owner}"\\s+all\\s+scram-sha-256$`,
        "mu"
      )
    );
    const hostRuntimeAllow = generated.stdout.search(
      new RegExp(
        `^host\\s+${mapping.database}\\s+"${mapping.runtime}"\\s+all\\s+scram-sha-256$`,
        "mu"
      )
    );
    assert.ok(localAllow >= 0 && localAllow < localFamilyReject);
    assert.ok(localRuntimeAllow >= 0 && localRuntimeAllow < localFamilyReject);
    assert.ok(hostAllow >= 0 && hostAllow < hostFamilyReject);
    assert.ok(hostRuntimeAllow >= 0 && hostRuntimeAllow < hostFamilyReject);
  }

  const localRankAllow = generated.stdout.search(
    /^local\s+jobs_db\s+"jobs_rank_runtime"\s+scram-sha-256$/mu
  );
  const hostRankAllow = generated.stdout.search(
    /^host\s+jobs_db\s+"jobs_rank_runtime"\s+all\s+scram-sha-256$/mu
  );
  const localRankReject = generated.stdout.search(
    /^local\s+all\s+\/\^jobs_rank_runtime\(_\[a-z0-9_\]\+\)\?\$\s+reject$/mu
  );
  const hostRankReject = generated.stdout.search(
    /^host\s+all\s+\/\^jobs_rank_runtime\(_\[a-z0-9_\]\+\)\?\$\s+all\s+reject$/mu
  );
  assert.ok(localRankAllow >= 0 && localRankAllow < localRankReject);
  assert.ok(hostRankAllow >= 0 && hostRankAllow < hostRankReject);
  assert.ok(localGeneral > localRankReject);
  assert.ok(hostGeneral > hostRankReject);

  const localAuthEmailAllow = generated.stdout.search(
    /^local\s+jobs_db\s+"jobs_auth_email_runtime"\s+scram-sha-256$/mu
  );
  const hostAuthEmailAllow = generated.stdout.search(
    /^host\s+jobs_db\s+"jobs_auth_email_runtime"\s+all\s+scram-sha-256$/mu
  );
  const localAuthEmailReject = generated.stdout.search(
    /^local\s+all\s+\/\^jobs_auth_email_runtime\(_\[a-z0-9_\]\+\)\?\$\s+reject$/mu
  );
  const hostAuthEmailReject = generated.stdout.search(
    /^host\s+all\s+\/\^jobs_auth_email_runtime\(_\[a-z0-9_\]\+\)\?\$\s+all\s+reject$/mu
  );
  assert.ok(
    localAuthEmailAllow >= 0 && localAuthEmailAllow < localAuthEmailReject
  );
  assert.ok(
    hostAuthEmailAllow >= 0 && hostAuthEmailAllow < hostAuthEmailReject
  );
  assert.ok(localGeneral > localAuthEmailReject);
  assert.ok(hostGeneral > hostAuthEmailReject);

  assert.doesNotMatch(generated.stdout, /directus/u);
  assert.doesNotMatch(generated.stdout, /^host\s+.+\s+trust$/mu);

  for (const forbiddenBootstrapRole of [
    "platform_owner",
    "seo_runtime",
    "jobs_owner",
    "jobs_rank_runtime",
    "jobs_auth_email_runtime",
    "realtime_runtime"
  ]) {
    const invalid = await runProcess(
      "/bin/sh",
      [fileURLToPath(entrypointUrl), "--print-hba"],
      {
        ...process.env,
        POSTGRES_USER: forbiddenBootstrapRole,
        JOBS_CONNECTOR_DATABASE_USER: "jobs_connector"
      }
    );
    assert.notEqual(invalid.code, 0);
    assert.equal(invalid.stdout, "");
  }
});

function runProcess(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
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
  });
}

function serviceDatabasePasswordEnvironment() {
  const names = [
    "PLATFORM_DATABASE_OWNER_PASSWORD",
    "PLATFORM_DATABASE_PASSWORD",
    "SEO_DATABASE_OWNER_PASSWORD",
    "SEO_DATABASE_PASSWORD",
    "JOBS_DATABASE_OWNER_PASSWORD",
    "JOBS_DATABASE_PASSWORD",
    "JOBS_RANK_DATABASE_PASSWORD",
    "JOBS_AUTH_EMAIL_DATABASE_PASSWORD",
    "REALTIME_DATABASE_OWNER_PASSWORD",
    "REALTIME_DATABASE_PASSWORD"
  ];
  return {
    ...process.env,
    ...Object.fromEntries(
      names.map((name, index) => [
        name,
        `DatabaseRole-${index}-${"x".repeat(32)}`
      ])
    )
  };
}
