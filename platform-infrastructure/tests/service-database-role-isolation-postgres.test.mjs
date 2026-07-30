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
    packageName: "@seo-platform/platform-api"
  },
  {
    database: "seo_db",
    owner: "seo_owner",
    ownerSecret: "SEO_DATABASE_OWNER_PASSWORD",
    runtime: "seo_runtime",
    runtimeSecret: "SEO_DATABASE_PASSWORD",
    packageName: "@seo-platform/seo-data"
  },
  {
    database: "jobs_db",
    owner: "jobs_owner",
    ownerSecret: "JOBS_DATABASE_OWNER_PASSWORD",
    runtime: "jobs_runtime",
    runtimeSecret: "JOBS_DATABASE_PASSWORD",
    packageName: "@seo-platform/jobs-integrations"
  },
  {
    database: "realtime_db",
    owner: "realtime_owner",
    ownerSecret: "REALTIME_DATABASE_OWNER_PASSWORD",
    runtime: "realtime_runtime",
    runtimeSecret: "REALTIME_DATABASE_PASSWORD",
    packageName: "@seo-platform/realtime"
  }
];

test(
  "PostgreSQL 18 isolates migration owners, service runtimes, connector and Directus",
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
        "DIRECTUS_DATABASE_PASSWORD",
        "JOBS_CONNECTOR_DATABASE_PASSWORD"
      ].map((secretName) => [
        secretName,
        `${secretName.toLowerCase().replaceAll("_", "-")}-${randomBytes(24).toString("base64url")}`
      ])
    );
    assert.equal(new Set(Object.values(passwords)).size, 10);

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
      await assertOwnerAndDirectusBoundaries(admin, passwords);
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
         'platform_db', 'seo_db', 'jobs_db', 'realtime_db', 'directus_db'
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
          OR rolname IN ('directus_runtime_owner', 'jobs_connector')`
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
         'jobs_owner', 'jobs_runtime',
         'realtime_owner', 'realtime_runtime',
         'directus_runtime_owner', 'jobs_connector'
       )
         AND rolcanlogin
         AND NOT rolsuper
         AND NOT rolcreatedb
         AND NOT rolcreaterole
         AND NOT rolinherit
         AND NOT rolreplication
         AND NOT rolbypassrls`
    ),
    "10"
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
           'jobs_owner', 'jobs_runtime',
           'realtime_owner', 'realtime_runtime',
           'directus_runtime_owner', 'jobs_connector'
         )
       ) OR membership.roleid IN (
         SELECT oid FROM pg_roles
         WHERE rolname IN (
           'platform_owner', 'platform_runtime',
           'seo_owner', 'seo_runtime',
           'jobs_owner', 'jobs_runtime',
           'realtime_owner', 'realtime_runtime',
           'directus_runtime_owner', 'jobs_connector'
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
}

async function assertOwnerAndDirectusBoundaries(admin, passwords) {
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

  const directus = roleEnvironment(
    admin,
    "directus_runtime_owner",
    "directus_db",
    passwords.DIRECTUS_DATABASE_PASSWORD
  );
  assert.equal(
    await checkedPsql(
      directus,
      `CREATE TABLE public.directus_migration_probe(id UUID DEFAULT uuidv7());
       INSERT INTO public.directus_migration_probe DEFAULT VALUES;
       SELECT count(*) FROM public.directus_migration_probe;
       DROP TABLE public.directus_migration_probe;`
    ),
    "1"
  );
  await assertConnectionDenied(
    { ...directus, PGDATABASE: "platform_db" },
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
  assert.equal(
    await checkedPsql(
      { ...admin, PGDATABASE: "jobs_db" },
      `SELECT count(*)
       FROM pg_proc routine
       JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
       WHERE namespace.nspname = 'public'
         AND has_function_privilege('jobs_connector', routine.oid, 'EXECUTE')`
    ),
    "8"
  );
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

  const directus = roleEnvironment(
    admin,
    "directus_runtime_owner",
    "directus_db",
    passwords.DIRECTUS_DATABASE_PASSWORD
  );
  assert.equal(
    await checkedPsql(directus, "SELECT current_database()"),
    "directus_db"
  );
  await assertConnectionDenied(
    { ...directus, PGDATABASE: "jobs_db" },
    /pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
  );

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
    "realtime_db",
    "directus_db"
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
    "jobs_owner",
    "realtime_runtime",
    "realtime_owner",
    "directus_runtime_owner"
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
