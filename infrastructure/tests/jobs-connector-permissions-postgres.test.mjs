import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

const databaseUrl =
  process.env.JOBS_CONNECTOR_PERMISSION_TEST_DATABASE_URL;
const psqlPath =
  process.env.JOBS_CONNECTOR_PERMISSION_TEST_PSQL ?? "psql";
const expectHbaBoundary =
  process.env.JOBS_CONNECTOR_PERMISSION_TEST_EXPECT_HBA === "true";
const permissionPath = fileURLToPath(
  new URL("../postgres/permissions/jobs-connector.sql", import.meta.url)
);
const provisionerPath = fileURLToPath(
  new URL(
    "../postgres/permissions/provision-jobs-connector-role.sh",
    import.meta.url
  )
);

test(
  "PostgreSQL 18 provisions a cluster-audited SCRAM connector with an exact routine allowlist",
  { skip: databaseUrl === undefined, timeout: 60_000 },
  async () => {
    assert.ok(databaseUrl);
    const adminEnvironment = postgresEnvironment(databaseUrl);
    assert.equal(adminEnvironment.PGDATABASE, "jobs_db");

    const suffix = randomBytes(6).toString("hex");
    const connectorRole =
      expectHbaBoundary
        ? "jobs_connector"
        : `jobs_connector_test_${suffix}`;
    const legacyConnectorRole = `jobs_connector_legacy_${suffix}`;
    const incomingRole = `jobs_connector_incoming_${suffix}`;
    const inheritedRole = `jobs_connector_inherited_${suffix}`;
    const foreignOwnerFunction = `jobs_connector_foreign_owner_${suffix}`;
    const privateSchema = `jobs_connector_private_${suffix}`;
    const privateTable = `jobs_connector_private_table_${suffix}`;
    const publicLeakSchema = `jobs_connector_public_leak_${suffix}`;
    const publicLeakTable = `jobs_connector_public_table_${suffix}`;
    const publicLeakSequence = `jobs_connector_public_sequence_${suffix}`;
    const publicLeakProcedure = `jobs_connector_public_procedure_${suffix}`;
    const foreignObjectDatabase = `jobs_connector_object_db_${suffix}`;
    const foreignConnectDatabase = `jobs_connector_connect_db_${suffix}`;
    const preexistingProcedure = `jobs_connector_procedure_${suffix}`;
    const futureFunction = `jobs_connector_future_${suffix}`;
    const futureTable = `jobs_connector_future_table_${suffix}`;
    const futureSequence = `jobs_connector_future_sequence_${suffix}`;
    const connectorPassword = `test-${randomBytes(24).toString("base64url")}`;
    const legacyConnectorPassword =
      `legacy-${randomBytes(24).toString("base64url")}`;
    for (const identifier of [
      connectorRole,
      legacyConnectorRole,
      incomingRole,
      inheritedRole,
      foreignOwnerFunction,
      privateSchema,
      privateTable,
      publicLeakSchema,
      publicLeakTable,
      publicLeakSequence,
      publicLeakProcedure,
      foreignObjectDatabase,
      foreignConnectDatabase,
      preexistingProcedure,
      futureFunction,
      futureTable,
      futureSequence
    ]) {
      assert.match(identifier, /^[a-z0-9_]+$/u);
    }

    const provisionEnvironment = {
      ...adminEnvironment,
      // Prove the wrapper's session-local SET wins over a legacy caller
      // default instead of merely relying on PostgreSQL 18 defaults.
      PGOPTIONS: "-c password_encryption=md5",
      JOBS_CONNECTOR_DATABASE_USER: connectorRole,
      JOBS_CONNECTOR_DATABASE_PASSWORD: connectorPassword
    };

    try {
      await assertPostgres18(adminEnvironment);
      assert.equal(
        await checkedPsql(
          adminEnvironment,
          "SELECT rolsuper AND rolcreaterole FROM pg_roles WHERE rolname = current_user"
        ),
        "t",
        "the opt-in database URL must use a disposable cluster administrator"
      );
      await assertCanonicalJobsDatabase(adminEnvironment);
      assert.notEqual(connectorRole, adminEnvironment.PGUSER);

      const wrongDatabase = await runPsql(
        {
          ...provisionEnvironment,
          PGDATABASE: "postgres"
        },
        ["--file", permissionPath]
      );
      assert.notEqual(wrongDatabase.code, 0);
      assert.match(
        `${wrongDatabase.stdout}\n${wrongDatabase.stderr}`,
        /must be provisioned in jobs_db/u
      );

      await checkedPsql(
        adminEnvironment,
        `CREATE ROLE "${connectorRole}"
           LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
           NOINHERIT NOREPLICATION NOBYPASSRLS;
         CREATE ROLE "${incomingRole}"
           NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
           NOINHERIT NOREPLICATION NOBYPASSRLS;
         CREATE ROLE "${inheritedRole}"
           NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
           NOINHERIT NOREPLICATION NOBYPASSRLS;
         GRANT "${connectorRole}" TO "${incomingRole}";`
      );

      await assertProvisioningRejected(
        provisionEnvironment,
        connectorRole,
        connectorPassword
      );
      await checkedPsql(
        adminEnvironment,
        `REVOKE "${connectorRole}" FROM "${incomingRole}";
         GRANT "${inheritedRole}" TO "${connectorRole}";`
      );
      await assertProvisioningRejected(
        provisionEnvironment,
        connectorRole,
        connectorPassword
      );
      await checkedPsql(
        adminEnvironment,
        `REVOKE "${inheritedRole}" FROM "${connectorRole}"`
      );

      await checkedPsql(
        adminEnvironment,
        `CREATE FUNCTION public."${foreignOwnerFunction}"()
         RETURNS integer
         LANGUAGE sql
         IMMUTABLE
         SET search_path = pg_catalog
         AS 'SELECT 1';
         ALTER FUNCTION public."${foreignOwnerFunction}"()
         OWNER TO "${inheritedRole}";`
      );
      await assertMigrationOwnerRejected(
        provisionEnvironment,
        connectorRole,
        connectorPassword
      );
      await checkedPsql(
        adminEnvironment,
        `DROP FUNCTION public."${foreignOwnerFunction}"()`
      );

      await checkedPsql(
        adminEnvironment,
        `CREATE SCHEMA "${privateSchema}";
         CREATE TABLE "${privateSchema}"."${privateTable}" (id integer);
         GRANT USAGE ON SCHEMA "${privateSchema}" TO "${connectorRole}";
         GRANT SELECT ON TABLE "${privateSchema}"."${privateTable}"
           TO "${connectorRole}";
         ALTER DEFAULT PRIVILEGES IN SCHEMA "${privateSchema}"
           GRANT SELECT ON TABLES TO "${connectorRole}";`
      );
      await assertDirectAclRejected(
        provisionEnvironment,
        connectorRole,
        connectorPassword,
        /outside the exact jobs_db allowlist/u
      );
      await checkedPsql(
        adminEnvironment,
        `DROP SCHEMA "${privateSchema}" CASCADE`
      );

      await checkedPsql(
        adminEnvironment,
        `CREATE SCHEMA "${publicLeakSchema}";
         GRANT USAGE ON SCHEMA "${publicLeakSchema}" TO PUBLIC;
         CREATE TABLE "${publicLeakSchema}"."${publicLeakTable}" (id integer);
         GRANT SELECT ON TABLE "${publicLeakSchema}"."${publicLeakTable}"
           TO PUBLIC;
         CREATE SEQUENCE "${publicLeakSchema}"."${publicLeakSequence}";
         GRANT USAGE ON SEQUENCE
           "${publicLeakSchema}"."${publicLeakSequence}" TO PUBLIC;
         CREATE PROCEDURE "${publicLeakSchema}"."${publicLeakProcedure}"()
         LANGUAGE sql
         SECURITY DEFINER
         SET search_path = pg_catalog
         AS 'SELECT 1';`
      );
      assert.equal(
        await checkedPsql(
          adminEnvironment,
          `SELECT count(*)
           FROM pg_shdepend dependency
           WHERE dependency.refclassid = 'pg_authid'::regclass
             AND dependency.refobjid = '${connectorRole}'::regrole
             AND dependency.deptype = 'a'`
        ),
        "0",
        "fixture must exercise inherited PUBLIC rather than a direct role ACL"
      );
      await assertDirectAclRejected(
        provisionEnvironment,
        connectorRole,
        connectorPassword,
        /must not inherit reachable PUBLIC privileges/u
      );
      await checkedPsql(
        adminEnvironment,
        `DROP SCHEMA "${publicLeakSchema}" CASCADE`
      );

      await createDatabase(adminEnvironment, foreignObjectDatabase);
      await checkedPsql(
        { ...adminEnvironment, PGDATABASE: foreignObjectDatabase },
        `CREATE SCHEMA foreign_private;
         CREATE TABLE foreign_private.connector_acl_probe (id integer);
         GRANT USAGE ON SCHEMA foreign_private TO "${connectorRole}";
         GRANT SELECT ON TABLE foreign_private.connector_acl_probe
           TO "${connectorRole}";`
      );
      await assertDirectAclRejected(
        provisionEnvironment,
        connectorRole,
        connectorPassword,
        /outside jobs_db/u
      );
      await dropDatabase(adminEnvironment, foreignObjectDatabase);

      await createDatabase(adminEnvironment, foreignConnectDatabase);
      await checkedPsql(
        adminEnvironment,
        `GRANT CONNECT ON DATABASE "${foreignConnectDatabase}"
           TO "${connectorRole}"`
      );
      await assertDirectAclRejected(
        provisionEnvironment,
        connectorRole,
        connectorPassword,
        /outside jobs_db/u
      );
      await dropDatabase(adminEnvironment, foreignConnectDatabase);

      await checkedPsql(
        adminEnvironment,
        `ALTER DEFAULT PRIVILEGES FOR ROLE jobs_owner
           GRANT SELECT ON TABLES TO PUBLIC;
         ALTER DEFAULT PRIVILEGES FOR ROLE jobs_owner
           GRANT USAGE ON SEQUENCES TO PUBLIC;
         ALTER DEFAULT PRIVILEGES FOR ROLE jobs_owner IN SCHEMA public
           GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
         ALTER DEFAULT PRIVILEGES FOR ROLE jobs_owner IN SCHEMA public
           GRANT SELECT ON TABLES TO PUBLIC;
         ALTER DEFAULT PRIVILEGES FOR ROLE jobs_owner IN SCHEMA public
           GRANT USAGE ON SEQUENCES TO PUBLIC;
         SET ROLE jobs_owner;
         CREATE PROCEDURE public."${preexistingProcedure}"()
         LANGUAGE sql
         SECURITY DEFINER
         SET search_path = pg_catalog
         AS 'SELECT 1';
         RESET ROLE;
         GRANT EXECUTE ON PROCEDURE public."${preexistingProcedure}"()
           TO "${connectorRole}";`
      );

      const provisioned = await runProvisioner(provisionEnvironment);
      assert.equal(
        provisioned.code,
        0,
        `provisioner failed:\n${provisioned.stdout}\n${provisioned.stderr}`
      );
      assert.doesNotMatch(
        `${provisioned.stdout}\n${provisioned.stderr}`,
        new RegExp(escapeRegExp(connectorPassword), "u")
      );

      assert.equal(
        await checkedPsql(
          adminEnvironment,
          `SELECT rolcanlogin::text || '|' || rolsuper::text || '|' ||
                  rolcreatedb::text || '|' || rolcreaterole::text || '|' ||
                  rolinherit::text || '|' || rolreplication::text || '|' ||
                  rolbypassrls::text || '|' ||
                  (rolpassword LIKE 'SCRAM-SHA-256$%')::text
           FROM pg_authid
           WHERE rolname = '${connectorRole}'`
        ),
        "true|false|false|false|false|false|false|true"
      );
      assert.equal(
        await checkedPsql(
          adminEnvironment,
          `SELECT count(*)
           FROM pg_auth_members
           WHERE member = '${connectorRole}'::regrole
              OR roleid = '${connectorRole}'::regrole`
        ),
        "0"
      );
      assert.equal(
        await checkedPsql(
          adminEnvironment,
          `SELECT count(*)
           FROM pg_shdepend
           WHERE refclassid = 'pg_authid'::regclass
             AND refobjid = '${connectorRole}'::regrole
             AND deptype = 'o'`
        ),
        "0"
      );

      const connectorEnvironment = {
        ...adminEnvironment,
        PGUSER: connectorRole,
        PGPASSWORD: connectorPassword,
        PGOPTIONS: ""
      };
      assert.equal(
        await checkedPsql(
          connectorEnvironment,
          "SELECT current_user || '|' || current_database()"
        ),
        `${connectorRole}|jobs_db`
      );
      assert.equal(
        await checkedPsql(
          connectorEnvironment,
          `SELECT has_schema_privilege(current_user, 'public', 'USAGE')::text || '|' ||
                  has_schema_privilege(current_user, 'public', 'CREATE')::text`
        ),
        "true|false"
      );
      assert.equal(
        await checkedPsql(
          connectorEnvironment,
          `SELECT count(*)
           FROM pg_class relation
           JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
           WHERE namespace.nspname = 'public'
             AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
             AND (
               has_table_privilege(current_user, relation.oid, 'SELECT')
               OR has_table_privilege(current_user, relation.oid, 'INSERT')
               OR has_table_privilege(current_user, relation.oid, 'UPDATE')
               OR has_table_privilege(current_user, relation.oid, 'DELETE')
               OR has_table_privilege(current_user, relation.oid, 'TRUNCATE')
               OR has_table_privilege(current_user, relation.oid, 'REFERENCES')
               OR has_table_privilege(current_user, relation.oid, 'TRIGGER')
             )`
        ),
        "0"
      );
      assert.equal(
        await checkedPsql(
          connectorEnvironment,
          `SELECT count(*)
           FROM pg_class sequence
           JOIN pg_namespace namespace ON namespace.oid = sequence.relnamespace
           WHERE namespace.nspname = 'public'
             AND sequence.relkind = 'S'
             AND (
               has_sequence_privilege(current_user, sequence.oid, 'USAGE')
               OR has_sequence_privilege(current_user, sequence.oid, 'SELECT')
               OR has_sequence_privilege(current_user, sequence.oid, 'UPDATE')
             )`
        ),
        "0"
      );

      const directRead = await runPsql(connectorEnvironment, [
        "--command",
        "SELECT count(*) FROM public.integration_credentials"
      ]);
      assert.notEqual(directRead.code, 0);
      assert.match(directRead.stderr, /permission denied/u);

      assert.equal(
        await checkedPsql(
          adminEnvironment,
          `SELECT has_function_privilege(
             '${connectorRole}',
             'public."${preexistingProcedure}"()'::regprocedure,
             'EXECUTE'
           )`
        ),
        "f"
      );
      const preexistingProcedureCall = await runPsql(
        connectorEnvironment,
        ["--command", `CALL public."${preexistingProcedure}"()`]
      );
      assert.notEqual(preexistingProcedureCall.code, 0);
      assert.match(preexistingProcedureCall.stderr, /permission denied/u);

      await checkedPsql(
        adminEnvironment,
        `SET ROLE jobs_owner;
         CREATE FUNCTION public."${futureFunction}"()
         RETURNS integer
         LANGUAGE sql
         IMMUTABLE
         SET search_path = pg_catalog
         AS 'SELECT 1';
         CREATE TABLE public."${futureTable}" (id integer);
         CREATE SEQUENCE public."${futureSequence}";
         RESET ROLE;`
      );
      assert.equal(
        await checkedPsql(
          adminEnvironment,
          `SELECT (routine.proowner = 'jobs_owner'::regrole)::text || '|' ||
                  has_function_privilege(
                    '${connectorRole}', routine.oid, 'EXECUTE'
                  )::text
           FROM pg_proc routine
           JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
           WHERE namespace.nspname = 'public'
             AND routine.proname = '${futureFunction}'`
        ),
        "true|false"
      );
      const futureCall = await runPsql(connectorEnvironment, [
        "--command",
        `SELECT public."${futureFunction}"()`
      ]);
      assert.notEqual(futureCall.code, 0);
      assert.match(futureCall.stderr, /permission denied/u);

      assert.equal(
        await checkedPsql(
          adminEnvironment,
          `SELECT has_table_privilege(
                    '${connectorRole}',
                    'public."${futureTable}"',
                    'SELECT'
                  )::text || '|' ||
                  has_sequence_privilege(
                    '${connectorRole}',
                    'public."${futureSequence}"',
                    'USAGE'
                  )::text`
        ),
        "false|false"
      );
      const futureTableRead = await runPsql(connectorEnvironment, [
        "--command",
        `SELECT count(*) FROM public."${futureTable}"`
      ]);
      assert.notEqual(futureTableRead.code, 0);
      assert.match(futureTableRead.stderr, /permission denied/u);
      const futureSequenceRead = await runPsql(connectorEnvironment, [
        "--command",
        `SELECT nextval('public."${futureSequence}"')`
      ]);
      assert.notEqual(futureSequenceRead.code, 0);
      assert.match(futureSequenceRead.stderr, /permission denied/u);

      await assertNoPublicPrivileges(adminEnvironment);
      await assertExactAclDependencies(adminEnvironment, connectorRole);
      await assertExactRoutineAllowlist(
        connectorEnvironment,
        connectorRole
      );
      await assertManagementFunctionsDenied(
        adminEnvironment,
        connectorRole
      );

      if (expectHbaBoundary) {
        assert.equal(
          await checkedPsql(
            adminEnvironment,
            "SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL"
          ),
          "0"
        );
        await createDatabase(adminEnvironment, foreignConnectDatabase);
        await checkedPsql(
          adminEnvironment,
          `CREATE ROLE "${legacyConnectorRole}"
             LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
             NOINHERIT NOREPLICATION NOBYPASSRLS
             PASSWORD '${legacyConnectorPassword}'`
        );
        assert.equal(
          await checkedPsql(
            adminEnvironment,
            `SELECT has_database_privilege(
                      '${connectorRole}',
                      '${foreignConnectDatabase}',
                      'CONNECT'
                    )::text || '|' ||
                    count(*)::text
             FROM pg_shdepend dependency
             JOIN pg_database database
               ON dependency.dbid = 0
              AND dependency.classid = 'pg_database'::regclass
              AND database.oid = dependency.objid
             WHERE dependency.refclassid = 'pg_authid'::regclass
               AND dependency.refobjid = '${connectorRole}'::regrole
               AND dependency.deptype = 'a'
               AND database.datname = '${foreignConnectDatabase}'`
          ),
          "true|0"
        );
        assert.equal(
          await checkedPsql(
            adminEnvironment,
            `SELECT has_database_privilege(
                      '${legacyConnectorRole}',
                      '${foreignConnectDatabase}',
                      'CONNECT'
                    )::text || '|' ||
                    count(*)::text
             FROM pg_shdepend dependency
             JOIN pg_database database
               ON dependency.dbid = 0
              AND dependency.classid = 'pg_database'::regclass
              AND database.oid = dependency.objid
             WHERE dependency.refclassid = 'pg_authid'::regclass
               AND dependency.refobjid = '${legacyConnectorRole}'::regrole
               AND dependency.deptype = 'a'
               AND database.datname = '${foreignConnectDatabase}'`
          ),
          "true|0"
        );
        const foreignLogin = await runPsql(
          {
            ...connectorEnvironment,
            PGDATABASE: foreignConnectDatabase
          },
          ["--command", "SELECT current_database()"]
        );
        assert.notEqual(foreignLogin.code, 0);
        assert.match(
          foreignLogin.stderr,
          /pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
        );
        const legacyEnvironment = {
          ...adminEnvironment,
          PGUSER: legacyConnectorRole,
          PGPASSWORD: legacyConnectorPassword,
          PGOPTIONS: ""
        };
        for (const targetDatabase of [
          "jobs_db",
          foreignConnectDatabase
        ]) {
          const legacyLogin = await runPsql(
            {
              ...legacyEnvironment,
              PGDATABASE: targetDatabase
            },
            ["--command", "SELECT current_database()"]
          );
          assert.notEqual(legacyLogin.code, 0);
          assert.match(
            legacyLogin.stderr,
            /pg_hba\.conf rejects connection|no pg_hba\.conf entry/u
          );
        }
        await dropDatabase(adminEnvironment, foreignConnectDatabase);
      }
    } finally {
      await dropDatabase(adminEnvironment, foreignObjectDatabase);
      await dropDatabase(adminEnvironment, foreignConnectDatabase);
      await checkedPsql(
        adminEnvironment,
        `DROP SCHEMA IF EXISTS "${privateSchema}" CASCADE;
         DROP SCHEMA IF EXISTS "${publicLeakSchema}" CASCADE;
         DROP PROCEDURE IF EXISTS public."${preexistingProcedure}"();
         DROP TABLE IF EXISTS public."${futureTable}";
         DROP SEQUENCE IF EXISTS public."${futureSequence}";`
      );
      await cleanupTestFunctions(adminEnvironment, [
        foreignOwnerFunction,
        futureFunction
      ]);
      await cleanupPublicDefaultPrivileges(adminEnvironment);
      await cleanupTestRoles(adminEnvironment, [
        connectorRole,
        incomingRole,
        inheritedRole,
        legacyConnectorRole
      ]);
    }
  }
);

async function assertPostgres18(environment) {
  const version = Number(
    await checkedPsql(environment, "SHOW server_version_num")
  );
  assert.ok(version >= 180_000 && version < 190_000);
}

async function assertCanonicalJobsDatabase(environment) {
  assert.equal(
    await checkedPsql(
      environment,
      `SELECT (database.datdba = 'jobs_owner'::regrole)::text || '|' ||
              (relation.relowner = 'jobs_owner'::regrole)::text
       FROM pg_database database
       JOIN pg_class relation
         ON relation.oid = 'public._prisma_migrations'::regclass
       WHERE database.datname = current_database()`
    ),
    "true|true",
    "the opt-in jobs_db must be provisioned and migrated by canonical jobs_owner"
  );
}

async function assertProvisioningRejected(
  environment,
  connectorRole,
  connectorPassword
) {
  const rejected = await runProvisioner(environment);
  assert.notEqual(rejected.code, 0);
  assert.match(
    `${rejected.stdout}\n${rejected.stderr}`,
    /must not have role memberships/u
  );
  assert.doesNotMatch(
    `${rejected.stdout}\n${rejected.stderr}`,
    new RegExp(escapeRegExp(connectorPassword), "u")
  );
  assert.equal(
    await checkedPsql(
      environment,
      `SELECT (rolpassword IS NULL)::text
       FROM pg_authid
       WHERE rolname = '${connectorRole}'`
    ),
    "true"
  );
}

async function assertMigrationOwnerRejected(
  environment,
  connectorRole,
  connectorPassword
) {
  const rejected = await runProvisioner(environment);
  assert.notEqual(rejected.code, 0);
  assert.match(
    `${rejected.stdout}\n${rejected.stderr}`,
    /require jobs_owner to own Prisma history and public routines/u
  );
  assert.doesNotMatch(
    `${rejected.stdout}\n${rejected.stderr}`,
    new RegExp(escapeRegExp(connectorPassword), "u")
  );
  assert.equal(
    await checkedPsql(
      environment,
      `SELECT (rolpassword IS NULL)::text
       FROM pg_authid
       WHERE rolname = '${connectorRole}'`
    ),
    "true"
  );
}

async function assertDirectAclRejected(
  environment,
  connectorRole,
  connectorPassword,
  expectedError
) {
  const rejected = await runProvisioner(environment);
  assert.notEqual(rejected.code, 0);
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, expectedError);
  assert.doesNotMatch(
    `${rejected.stdout}\n${rejected.stderr}`,
    new RegExp(escapeRegExp(connectorPassword), "u")
  );
  assert.equal(
    await checkedPsql(
      environment,
      `SELECT (rolpassword IS NULL)::text
       FROM pg_authid
       WHERE rolname = '${connectorRole}'`
    ),
    "true"
  );
}

async function assertNoPublicPrivileges(environment) {
  const checks = [
    `SELECT count(*)
     FROM pg_database database
     CROSS JOIN LATERAL aclexplode(
       COALESCE(database.datacl, acldefault('d', database.datdba))
     ) privilege
     WHERE database.datname = 'jobs_db'
       AND privilege.grantee = 0`,
    `SELECT count(*)
     FROM pg_namespace namespace
     CROSS JOIN LATERAL aclexplode(
       COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
     ) privilege
     WHERE namespace.nspname = 'public'
       AND privilege.grantee = 0`,
    `SELECT count(*)
     FROM pg_class relation
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     CROSS JOIN LATERAL aclexplode(
       COALESCE(relation.relacl, acldefault('r', relation.relowner))
     ) privilege
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND privilege.grantee = 0`,
    `SELECT count(*)
     FROM pg_proc function
     JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
     CROSS JOIN LATERAL aclexplode(
       COALESCE(function.proacl, acldefault('f', function.proowner))
     ) privilege
     WHERE namespace.nspname = 'public'
       AND privilege.grantee = 0`,
    `SELECT count(*)
     FROM pg_class sequence
     JOIN pg_namespace namespace ON namespace.oid = sequence.relnamespace
     CROSS JOIN LATERAL aclexplode(
       COALESCE(sequence.relacl, acldefault('S', sequence.relowner))
     ) privilege
     WHERE namespace.nspname = 'public'
       AND sequence.relkind = 'S'
       AND privilege.grantee = 0`,
    `SELECT count(*)
     FROM pg_default_acl defaults
     CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
     WHERE defaults.defaclrole = 'jobs_owner'::regrole
       AND defaults.defaclnamespace IN (0, 'public'::regnamespace)
       AND defaults.defaclobjtype IN ('r', 'S', 'f')
       AND privilege.grantee = 0`
  ];
  for (const sql of checks) {
    assert.equal(await checkedPsql(environment, sql), "0");
  }
}

async function assertExactAclDependencies(environment, connectorRole) {
  assert.equal(
    await checkedPsql(
      environment,
      `SELECT count(*)::text || '|' ||
              count(*) FILTER (
                WHERE dependency.dbid = 0
                  AND dependency.classid = 'pg_database'::regclass
                  AND dependency.objid = (
                    SELECT oid
                    FROM pg_database
                    WHERE datname = current_database()
                  )
              )::text || '|' ||
              count(*) FILTER (
                WHERE dependency.dbid = (
                        SELECT oid
                        FROM pg_database
                        WHERE datname = current_database()
                      )
                  AND dependency.classid = 'pg_namespace'::regclass
                  AND dependency.objid = 'public'::regnamespace
              )::text || '|' ||
              count(*) FILTER (
                WHERE dependency.dbid = (
                        SELECT oid
                        FROM pg_database
                        WHERE datname = current_database()
                      )
                  AND dependency.classid = 'pg_proc'::regclass
              )::text
       FROM pg_shdepend dependency
       WHERE dependency.refclassid = 'pg_authid'::regclass
         AND dependency.refobjid = '${connectorRole}'::regrole
         AND dependency.deptype = 'a'`
    ),
    "10|1|1|8"
  );
}

async function assertExactRoutineAllowlist(
  connectorEnvironment,
  connectorRole
) {
  const permissionSql = await readFile(permissionPath, "utf8");
  const compact = permissionSql.replace(/\s+/gu, " ").trim();
  const expected = [
    ...compact.matchAll(
      /GRANT EXECUTE ON FUNCTION (public\.[a-z0-9_]+\([^)]*\)) TO %I/giu
    )
  ]
    .map((match) => normalizeSignature(match[1]))
    .sort();
  assert.ok(expected.length >= 8);
  assert.ok(
    expected.includes(
      "public.authorize_rank_connector_execution_submit(uuid,uuid,text,uuid,integer,integer,text)"
    )
  );

  const actual = (
    await checkedPsql(
      connectorEnvironment,
      `SELECT format(
                '%I.%I(%s)',
                namespace.nspname,
                function.proname,
                oidvectortypes(function.proargtypes)
              )
       FROM pg_proc function
       JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
       WHERE namespace.nspname = 'public'
         AND has_function_privilege(current_user, function.oid, 'EXECUTE')
       ORDER BY 1`
    )
  )
    .split("\n")
    .filter(Boolean)
    .map(normalizeSignature)
    .sort();
  assert.deepEqual(actual, expected);

  assert.equal(
    await checkedPsql(
      connectorEnvironment,
      `SELECT count(*)
       FROM pg_proc function
       JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
       WHERE namespace.nspname = 'public'
         AND has_function_privilege('${connectorRole}', function.oid, 'EXECUTE')`
    ),
    String(expected.length)
  );
}

async function assertManagementFunctionsDenied(environment, connectorRole) {
  for (const functionName of [
    "list_integration_credential_key_versions",
    "register_integration_credential_kek_canary",
    "claim_rank_connector_execution_pre_authorization"
  ]) {
    const result = await checkedPsql(
      environment,
      `SELECT count(*)::text || '|' ||
              count(*) FILTER (
                WHERE has_function_privilege(
                  '${connectorRole}', function.oid, 'EXECUTE'
                )
              )::text
       FROM pg_proc function
       JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
       WHERE namespace.nspname = 'public'
         AND function.proname = '${functionName}'`
    );
    const [existing, accessible] = result.split("|");
    assert.ok(Number(existing) >= 1, `${functionName} must exist after 018`);
    assert.equal(accessible, "0");
  }
}

async function cleanupTestFunctions(environment, functionNames) {
  for (const functionName of functionNames) {
    await checkedPsql(
      environment,
      `DROP FUNCTION IF EXISTS public."${functionName}"()`
    );
  }
}

async function cleanupPublicDefaultPrivileges(environment) {
  await checkedPsql(
    environment,
    `ALTER DEFAULT PRIVILEGES FOR ROLE jobs_owner
       REVOKE SELECT ON TABLES FROM PUBLIC;
     ALTER DEFAULT PRIVILEGES FOR ROLE jobs_owner
       REVOKE USAGE ON SEQUENCES FROM PUBLIC;
     ALTER DEFAULT PRIVILEGES FOR ROLE jobs_owner IN SCHEMA public
       REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
     ALTER DEFAULT PRIVILEGES FOR ROLE jobs_owner IN SCHEMA public
       REVOKE SELECT ON TABLES FROM PUBLIC;
     ALTER DEFAULT PRIVILEGES FOR ROLE jobs_owner IN SCHEMA public
       REVOKE USAGE ON SEQUENCES FROM PUBLIC;`
  );
}

function createDatabase(environment, databaseName) {
  return checkedPsql(environment, `CREATE DATABASE "${databaseName}"`);
}

async function dropDatabase(environment, databaseName) {
  const exists = await checkedPsql(
    environment,
    `SELECT EXISTS (
       SELECT 1 FROM pg_database WHERE datname = '${databaseName}'
     )`
  );
  if (exists === "t") {
    await checkedPsql(
      environment,
      `DROP DATABASE "${databaseName}" WITH (FORCE)`
    );
  }
}

async function cleanupTestRoles(environment, roles) {
  const incomingRole = roles[1];
  const connectorRole = roles[0];
  const inheritedRole = roles[2];
  for (const role of [
    ...roles.slice(3),
    incomingRole,
    connectorRole,
    inheritedRole
  ]) {
    const exists = await checkedPsql(
      environment,
      `SELECT EXISTS (
         SELECT 1 FROM pg_roles WHERE rolname = '${role}'
       )`
    );
    if (exists === "t") {
      await checkedPsql(environment, `DROP OWNED BY "${role}"`);
      await checkedPsql(environment, `DROP ROLE "${role}"`);
    }
  }
}

function normalizeSignature(signature) {
  return signature.replace(/\s+/gu, "").toLowerCase();
}

function postgresEnvironment(value) {
  const url = new URL(value);
  assert.ok(
    url.protocol === "postgres:" || url.protocol === "postgresql:"
  );
  const configuredPsqlDirectory = psqlPath.includes("/")
    ? dirname(psqlPath)
    : undefined;
  const inheritedPath = process.env.PATH ?? "/usr/bin:/bin";
  return {
    ...process.env,
    PATH: configuredPsqlDirectory
      ? `${configuredPsqlDirectory}${delimiter}${inheritedPath}`
      : inheritedPath,
    PGHOST: decodeURIComponent(
      url.searchParams.get("host") ?? url.hostname
    ),
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

function runProvisioner(environment) {
  return runProcess("/bin/sh", [provisionerPath], environment);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
