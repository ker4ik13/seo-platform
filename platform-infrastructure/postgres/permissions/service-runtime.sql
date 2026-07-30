\set ON_ERROR_STOP on

BEGIN;

SELECT CASE current_database()
  WHEN 'platform_db' THEN 'platform_owner'
  WHEN 'seo_db' THEN 'seo_owner'
  WHEN 'jobs_db' THEN 'jobs_owner'
  WHEN 'realtime_db' THEN 'realtime_owner'
  ELSE NULL
END AS expected_owner,
CASE current_database()
  WHEN 'platform_db' THEN 'platform_runtime'
  WHEN 'seo_db' THEN 'seo_runtime'
  WHEN 'jobs_db' THEN 'jobs_runtime'
  WHEN 'realtime_db' THEN 'realtime_runtime'
  ELSE NULL
END AS runtime_role,
current_database() AS database_name
\gset

SELECT set_config(
  'seo_platform.service_runtime_role',
  :'runtime_role',
  false
);

DO $$
DECLARE
  database_owner_id OID;
  expected_owner TEXT := current_setting('seo_platform.expected_owner', TRUE);
  runtime_role TEXT := current_setting('seo_platform.service_runtime_role');
  runtime_role_id OID;
BEGIN
  expected_owner := CASE current_database()
    WHEN 'platform_db' THEN 'platform_owner'
    WHEN 'seo_db' THEN 'seo_owner'
    WHEN 'jobs_db' THEN 'jobs_owner'
    WHEN 'realtime_db' THEN 'realtime_owner'
    ELSE NULL
  END;

  IF expected_owner IS NULL
    OR current_user <> expected_owner
  THEN
    RAISE EXCEPTION
      'service runtime permissions must run as the canonical migration owner in its own database';
  END IF;

  SELECT datdba
  INTO STRICT database_owner_id
  FROM pg_database
  WHERE datname = current_database();

  IF pg_get_userbyid(database_owner_id) <> expected_owner THEN
    RAISE EXCEPTION
      'service database is not owned by the canonical migration owner';
  END IF;

  SELECT oid
  INTO STRICT runtime_role_id
  FROM pg_roles
  WHERE rolname = runtime_role;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE oid = runtime_role_id
      AND (
        NOT rolcanlogin
        OR rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolinherit
        OR rolreplication
        OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION
      'runtime service role has unsafe attributes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members
    WHERE member = runtime_role_id
       OR roleid = runtime_role_id
  ) THEN
    RAISE EXCEPTION
      'runtime service role must not have membership edges';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = runtime_role_id
      AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION
      'runtime service role must not own database objects';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = '_prisma_migrations'
      AND pg_get_userbyid(relation.relowner) = expected_owner
  ) THEN
    RAISE EXCEPTION
      'Prisma migration history must exist and belong to the canonical migration owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_namespace namespace
    WHERE namespace.nspname NOT IN (
      'public',
      'pg_catalog',
      'information_schema'
    )
      AND namespace.nspname NOT LIKE 'pg_toast%'
      AND namespace.nspname NOT LIKE 'pg_temp_%'
  ) THEN
    RAISE EXCEPTION
      'service database contains an unexpected non-system schema';
  END IF;

  IF pg_get_userbyid((
    SELECT nspowner
    FROM pg_namespace
    WHERE nspname = 'public'
  )) <> expected_owner THEN
    RAISE EXCEPTION
      'public schema must belong to the canonical migration owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend dependency
        WHERE dependency.classid = 'pg_class'::regclass
          AND dependency.objid = relation.oid
          AND dependency.deptype = 'e'
      )
      AND pg_get_userbyid(relation.relowner) <> expected_owner
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc routine
    JOIN pg_namespace namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend dependency
        WHERE dependency.classid = 'pg_proc'::regclass
          AND dependency.objid = routine.oid
          AND dependency.deptype = 'e'
      )
      AND pg_get_userbyid(routine.proowner) <> expected_owner
  ) OR EXISTS (
    SELECT 1
    FROM pg_type type_record
    JOIN pg_namespace namespace
      ON namespace.oid = type_record.typnamespace
    WHERE namespace.nspname = 'public'
      AND type_record.typisdefined
      AND type_record.typrelid = 0
      AND NOT (
        type_record.typelem <> 0
        AND type_record.typlen = -1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend dependency
        WHERE dependency.classid = 'pg_type'::regclass
          AND dependency.objid = type_record.oid
          AND dependency.deptype = 'e'
      )
      AND pg_get_userbyid(type_record.typowner) <> expected_owner
  ) OR EXISTS (
    SELECT 1
    FROM pg_extension extension_record
    JOIN pg_namespace namespace
      ON namespace.oid = extension_record.extnamespace
    WHERE namespace.nspname = 'public'
      AND pg_get_userbyid(extension_record.extowner) <> expected_owner
  ) THEN
    RAISE EXCEPTION
      'public objects must belong exclusively to the canonical migration owner';
  END IF;
END
$$;

REVOKE ALL PRIVILEGES ON DATABASE :"database_name" FROM :"runtime_role";
REVOKE CONNECT, TEMPORARY ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO :"runtime_role";

REVOKE ALL PRIVILEGES ON SCHEMA public FROM :"runtime_role";
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"runtime_role";

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM :"runtime_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;

SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO %I',
  namespace.nspname,
  relation.relname,
  :'runtime_role'
)
FROM pg_class relation
JOIN pg_namespace namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND relation.relname <> '_prisma_migrations'
ORDER BY relation.oid
\gexec

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM :"runtime_role";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

SELECT format(
  'GRANT USAGE, SELECT ON SEQUENCE %I.%I TO %I',
  namespace.nspname,
  sequence.relname,
  :'runtime_role'
)
FROM pg_class sequence
JOIN pg_namespace namespace
  ON namespace.oid = sequence.relnamespace
WHERE namespace.nspname = 'public'
  AND sequence.relkind = 'S'
ORDER BY sequence.oid
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I',
  routine.oid::regprocedure,
  :'runtime_role'
)
FROM pg_proc routine
JOIN pg_namespace namespace
  ON namespace.oid = routine.pronamespace
WHERE namespace.nspname = 'public'
  AND routine.prokind = 'f'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_depend dependency
    WHERE dependency.classid = 'pg_proc'::regclass
      AND dependency.objid = routine.oid
      AND dependency.deptype = 'e'
  )
ORDER BY routine.oid
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC',
  routine.oid::regprocedure
)
FROM pg_proc routine
JOIN pg_namespace namespace
  ON namespace.oid = routine.pronamespace
WHERE namespace.nspname = 'public'
  AND routine.prokind = 'f'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_depend dependency
    WHERE dependency.classid = 'pg_proc'::regclass
      AND dependency.objid = routine.oid
      AND dependency.deptype = 'e'
  )
ORDER BY routine.oid
\gexec

-- Exact application routines required by direct runtime queries or CHECK
-- constraints. Trigger routines execute through their trigger and do not get
-- a direct EXECUTE grant. Any new callable routine must be reviewed here.
SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  routine_signature,
  :'runtime_role'
)
FROM unnest(CASE current_database()
  WHEN 'seo_db' THEN ARRAY[
    'public.rank_data_quality_flags_valid(jsonb)'
  ]
  WHEN 'jobs_db' THEN ARRAY[
    'public.manual_rank_job_state_is_coherent(public."JobStatus",public."RankManifestSealState",public."RankCheckFinalStatus")',
    'public.rank_execution_grant_request_is_exact(jsonb,uuid,uuid,uuid,uuid,integer,integer,bytea)',
    'public.rank_execution_grant_decision_is_exact(jsonb,text,bytea,bytea,timestamp with time zone,timestamp with time zone)',
    'public.list_integration_credential_key_versions()',
    'public.register_integration_credential_kek_canary(integer,bytea,bytea,bytea,bytea,bytea,bytea)'
  ]
  ELSE ARRAY[]::TEXT[]
END) AS required_routine(routine_signature)
ORDER BY routine_signature
\gexec

ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner"
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner"
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner"
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner"
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role";

ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner" IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner" IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner" IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role";

DO $$
DECLARE
  runtime_role_id OID := (
    SELECT oid
    FROM pg_roles
    WHERE rolname = current_setting('seo_platform.service_runtime_role')
  );
BEGIN
  IF has_database_privilege(runtime_role_id, current_database(), 'CREATE')
    OR has_database_privilege(runtime_role_id, current_database(), 'TEMPORARY')
    OR has_schema_privilege(runtime_role_id, 'public', 'CREATE')
  THEN
    RAISE EXCEPTION
      'runtime service role retained DDL privileges';
  END IF;

  IF has_table_privilege(
    runtime_role_id,
    'public._prisma_migrations',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) THEN
    RAISE EXCEPTION
      'runtime service role must not access Prisma migration history';
  END IF;
END
$$;

COMMIT;
