\set ON_ERROR_STOP on

DO $$
DECLARE
  mapping RECORD;
  role_record RECORD;
  expected_database_id OID;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'service database role audit must connect to postgres';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = current_user
      AND rolsuper
  ) THEN
    RAISE EXCEPTION
      'service database role audit requires the cluster bootstrap administrator';
  END IF;

  FOR mapping IN
    SELECT *
    FROM (VALUES
      ('platform_owner', 'platform_db', TRUE),
      ('platform_runtime', 'platform_db', FALSE),
      ('seo_owner', 'seo_db', TRUE),
      ('seo_runtime', 'seo_db', FALSE),
      ('jobs_owner', 'jobs_db', TRUE),
      ('jobs_runtime', 'jobs_db', FALSE),
      ('realtime_owner', 'realtime_db', TRUE),
      ('realtime_runtime', 'realtime_db', FALSE),
      ('directus_runtime_owner', 'directus_db', TRUE)
    ) AS role_mapping(role_name, database_name, may_own)
  LOOP
    SELECT *
    INTO STRICT role_record
    FROM pg_roles
    WHERE rolname = mapping.role_name;

    SELECT oid
    INTO STRICT expected_database_id
    FROM pg_database
    WHERE datname = mapping.database_name;

    IF NOT role_record.rolcanlogin
      OR role_record.rolsuper
      OR role_record.rolcreatedb
      OR role_record.rolcreaterole
      OR role_record.rolinherit
      OR role_record.rolreplication
      OR role_record.rolbypassrls
    THEN
      RAISE EXCEPTION
        'service database role % has unsafe attributes', mapping.role_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_auth_members
      WHERE member = role_record.oid
         OR roleid = role_record.oid
    ) THEN
      RAISE EXCEPTION
        'service database role % has membership edges', mapping.role_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_shdepend dependency
      LEFT JOIN pg_database local_database
        ON local_database.oid = dependency.dbid
      WHERE dependency.refclassid = 'pg_authid'::regclass
        AND dependency.refobjid = role_record.oid
        AND dependency.deptype = 'o'
        AND (
          NOT mapping.may_own
          OR (
            dependency.dbid = 0
            AND NOT (
              dependency.classid = 'pg_database'::regclass
              AND dependency.objid = expected_database_id
            )
          )
          OR (
            dependency.dbid <> 0
            AND local_database.oid IS DISTINCT FROM expected_database_id
          )
        )
    ) THEN
      RAISE EXCEPTION
        'service database role % owns objects outside its boundary',
        mapping.role_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_shdepend dependency
      LEFT JOIN pg_database local_database
        ON local_database.oid = dependency.dbid
      LEFT JOIN pg_database shared_database
        ON dependency.dbid = 0
       AND dependency.classid = 'pg_database'::regclass
       AND shared_database.oid = dependency.objid
      WHERE dependency.refclassid = 'pg_authid'::regclass
        AND dependency.refobjid = role_record.oid
        AND dependency.deptype = 'a'
        AND (
          (
            dependency.dbid = 0
            AND (
              dependency.classid <> 'pg_database'::regclass
              OR shared_database.oid IS DISTINCT FROM expected_database_id
            )
          )
          OR (
            dependency.dbid <> 0
            AND local_database.oid IS DISTINCT FROM expected_database_id
          )
        )
    ) THEN
      RAISE EXCEPTION
        'service database role % has ACL outside its database boundary',
        mapping.role_name;
    END IF;

    IF NOT mapping.may_own AND EXISTS (
      SELECT 1
      FROM pg_shdepend dependency
      WHERE dependency.refclassid = 'pg_authid'::regclass
        AND dependency.refobjid = role_record.oid
        AND dependency.deptype = 'o'
    ) THEN
      RAISE EXCEPTION
        'runtime service role % must not own database objects',
        mapping.role_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_authid authentication_role
      WHERE authentication_role.oid = role_record.oid
        AND authentication_role.rolpassword LIKE 'SCRAM-SHA-256$%'
    ) THEN
      RAISE EXCEPTION
        'service database role % does not have a SCRAM verifier',
        mapping.role_name;
    END IF;
  END LOOP;
END
$$;
