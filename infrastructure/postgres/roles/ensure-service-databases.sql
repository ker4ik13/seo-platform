\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'service database creation must connect to postgres';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = current_user
      AND rolsuper
  ) THEN
    RAISE EXCEPTION
      'service database creation requires the cluster bootstrap administrator';
  END IF;
END
$$;

SELECT format(
  'CREATE DATABASE %I OWNER %I TEMPLATE template0 ENCODING %L',
  database_name,
  owner_role,
  'UTF8'
)
FROM (VALUES
  ('platform_db', 'platform_owner'),
  ('seo_db', 'seo_owner'),
  ('jobs_db', 'jobs_owner'),
  ('realtime_db', 'realtime_owner')
) AS service_database(database_name, owner_role)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_database
  WHERE datname = service_database.database_name
)
\gexec
