\set ON_ERROR_STOP on
\getenv connector_user JOBS_CONNECTOR_DATABASE_USER
\getenv connector_password JOBS_CONNECTOR_DATABASE_PASSWORD

-- Never repurpose an existing privileged or inherited role as the worker.
SELECT set_config(
  'seo_platform.connector_user',
  :'connector_user',
  false
);

DO $$
DECLARE
  connector_user text :=
    current_setting('seo_platform.connector_user');
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = connector_user
      AND (
        rolsuper
        OR rolcreatedb
        OR rolcreaterole
        OR rolreplication
        OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION
      'connector database role must not have privileged attributes';
  END IF;
END
$$;

SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'connector_user',
  :'connector_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'connector_user'
)
\gexec

DO $$
DECLARE
  connector_user text :=
    current_setting('seo_platform.connector_user');
  connector_role_id oid;
BEGIN
  SELECT oid
  INTO connector_role_id
  FROM pg_roles
  WHERE rolname = connector_user;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members
    WHERE member = connector_role_id
  ) THEN
    RAISE EXCEPTION
      'connector database role must not inherit another role';
  END IF;

  -- Ownership cannot be removed with REVOKE and would bypass the explicit
  -- grants below. pg_shdepend covers owned objects across this PostgreSQL
  -- cluster, not only objects visible in the current database.
  IF EXISTS (
    SELECT 1
    FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = connector_role_id
      AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION
      'connector database role must not own database objects';
  END IF;
END
$$;

SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'connector_user',
  :'connector_password'
)
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON DATABASE jobs_db FROM %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT CONNECT ON DATABASE jobs_db TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT USAGE ON SCHEMA public TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
  :'connector_user'
)
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
  :'connector_user'
)
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT SELECT ON TABLE jobs, integration_credentials TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT UPDATE (
    status, stage, progress_current, attempt, error_summary, result_summary,
    started_at, finished_at, lease_owner, lease_expires_at, retry_at,
    updated_at, version
  ) ON TABLE jobs TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT UPDATE (
    status, provider_meta, verified_at, last_success_at, last_error_at,
    last_error_code, updated_by, updated_at, version
  ) ON TABLE integration_credentials TO %I',
  :'connector_user'
)
\gexec
