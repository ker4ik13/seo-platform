\set ON_ERROR_STOP on
\getenv expected_database SERVICE_DATABASE_NAME
\getenv expected_owner SERVICE_DATABASE_OWNER_ROLE

BEGIN;

SELECT set_config(
  'seo_platform.expected_database',
  :'expected_database',
  false
);
SELECT set_config(
  'seo_platform.expected_owner',
  :'expected_owner',
  false
);

DO $$
DECLARE
  database_owner_name TEXT;
  expected_database TEXT :=
    current_setting('seo_platform.expected_database');
  expected_owner TEXT :=
    current_setting('seo_platform.expected_owner');
  public_schema_owner TEXT;
  user_object_count BIGINT;
BEGIN
  IF (expected_database, expected_owner) NOT IN (
    ('platform_db', 'platform_owner'),
    ('seo_db', 'seo_owner'),
    ('jobs_db', 'jobs_owner'),
    ('realtime_db', 'realtime_owner')
  ) THEN
    RAISE EXCEPTION
      'invalid service database ownership mapping';
  END IF;

  IF current_database() <> expected_database THEN
    RAISE EXCEPTION
      'ownership preparation connected to unexpected database';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = current_user
      AND rolsuper
  ) THEN
    RAISE EXCEPTION
      'ownership preparation requires the cluster bootstrap administrator';
  END IF;

  SELECT pg_get_userbyid(datdba)
  INTO STRICT database_owner_name
  FROM pg_database
  WHERE datname = expected_database;

  SELECT pg_get_userbyid(nspowner)
  INTO STRICT public_schema_owner
  FROM pg_namespace
  WHERE nspname = 'public';

  SELECT
    (
      SELECT count(*)
      FROM pg_class relation
      JOIN pg_namespace namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    ) + (
      SELECT count(*)
      FROM pg_proc routine
      JOIN pg_namespace namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
    ) + (
      SELECT count(*)
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
    ) + (
      SELECT count(*)
      FROM pg_extension extension_record
      JOIN pg_namespace namespace
        ON namespace.oid = extension_record.extnamespace
      WHERE namespace.nspname = 'public'
    )
  INTO user_object_count;

  IF database_owner_name <> expected_owner
    AND user_object_count <> 0
  THEN
    RAISE EXCEPTION
      'legacy database % contains objects owned before service-role isolation; use the reviewed ownership handoff runbook',
      expected_database;
  END IF;

  IF database_owner_name <> expected_owner
    AND database_owner_name <> current_user
  THEN
    RAISE EXCEPTION
      'database % has an unexpected owner %',
      expected_database,
      database_owner_name;
  END IF;

  IF database_owner_name <> expected_owner THEN
    EXECUTE format(
      'ALTER DATABASE %I OWNER TO %I',
      expected_database,
      expected_owner
    );
  END IF;

  IF public_schema_owner <> expected_owner THEN
    IF user_object_count <> 0
      AND public_schema_owner NOT IN (current_user, 'pg_database_owner')
    THEN
      RAISE EXCEPTION
        'public schema in % has an unexpected owner %',
        expected_database,
        public_schema_owner;
    END IF;

    EXECUTE format(
      'ALTER SCHEMA public OWNER TO %I',
      expected_owner
    );
  END IF;
END
$$;

REVOKE CONNECT, TEMPORARY ON DATABASE :"expected_database" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner"
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner"
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner"
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner" IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner" IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE :"expected_owner" IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
DECLARE
  expected_owner TEXT :=
    current_setting('seo_platform.expected_owner');
BEGIN
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
      'public schema is not owned by the canonical service owner';
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
      'public objects are not owned exclusively by the canonical service owner';
  END IF;
END
$$;

COMMIT;
