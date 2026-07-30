\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  role_name TEXT;
  role_record RECORD;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'service database role bootstrap must connect to postgres';
  END IF;

  SELECT *
  INTO role_record
  FROM pg_roles
  WHERE rolname = current_user;

  IF role_record.rolsuper IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'service database role bootstrap requires the cluster bootstrap administrator';
  END IF;

  IF current_user = ANY (ARRAY[
    'platform_owner',
    'platform_runtime',
    'seo_owner',
    'seo_runtime',
    'jobs_owner',
    'jobs_runtime',
    'realtime_owner',
    'realtime_runtime',
    'directus_runtime_owner',
    'jobs_connector'
  ]) THEN
    RAISE EXCEPTION
      'cluster bootstrap administrator must differ from every service role';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'platform_owner',
    'platform_runtime',
    'seo_owner',
    'seo_runtime',
    'jobs_owner',
    'jobs_runtime',
    'realtime_owner',
    'realtime_runtime',
    'directus_runtime_owner'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = role_name
        AND (
          rolsuper
          OR rolcreatedb
          OR rolcreaterole
          OR rolinherit
          OR rolreplication
          OR rolbypassrls
        )
    ) THEN
      RAISE EXCEPTION
        'service database role % has forbidden attributes', role_name;
    END IF;
  END LOOP;
END
$$;

SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  role_name
)
FROM unnest(ARRAY[
  'platform_owner',
  'platform_runtime',
  'seo_owner',
  'seo_runtime',
  'jobs_owner',
  'jobs_runtime',
  'realtime_owner',
  'realtime_runtime',
  'directus_runtime_owner'
]) AS service_role(role_name)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_roles
  WHERE rolname = service_role.role_name
)
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  role_name
)
FROM unnest(ARRAY[
  'platform_owner',
  'platform_runtime',
  'seo_owner',
  'seo_runtime',
  'jobs_owner',
  'jobs_runtime',
  'realtime_owner',
  'realtime_runtime',
  'directus_runtime_owner'
]) AS service_role(role_name)
\gexec

DO $$
DECLARE
  service_role_id OID;
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'platform_owner',
    'platform_runtime',
    'seo_owner',
    'seo_runtime',
    'jobs_owner',
    'jobs_runtime',
    'realtime_owner',
    'realtime_runtime',
    'directus_runtime_owner'
  ]
  LOOP
    SELECT oid
    INTO STRICT service_role_id
    FROM pg_roles
    WHERE rolname = role_name;

    IF EXISTS (
      SELECT 1
      FROM pg_auth_members
      WHERE member = service_role_id
         OR roleid = service_role_id
    ) THEN
      RAISE EXCEPTION
        'service database role % must not have membership edges', role_name;
    END IF;
  END LOOP;
END
$$;

COMMIT;
