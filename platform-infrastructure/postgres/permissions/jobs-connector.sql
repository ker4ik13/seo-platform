\set ON_ERROR_STOP on
\getenv connector_user JOBS_CONNECTOR_DATABASE_USER

BEGIN;

DO $$
DECLARE
  migration_owner_id OID;
BEGIN
  IF current_database() <> 'jobs_db' THEN
    RAISE EXCEPTION
      'connector permissions must be provisioned in jobs_db';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = current_user
      AND rolsuper
  ) THEN
    RAISE EXCEPTION
      'connector role administration requires the cluster bootstrap administrator';
  END IF;

  SELECT oid
  INTO STRICT migration_owner_id
  FROM pg_roles
  WHERE rolname = 'jobs_owner';

  -- Default privileges belong to the object-creating role. Prisma migrations
  -- run as jobs_owner, while this narrowly-scoped role administration step
  -- uses the cluster bootstrap administrator to create/harden the login.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = '_prisma_migrations'
      AND relation.relowner = migration_owner_id
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc routine
    JOIN pg_namespace namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND routine.proowner <> migration_owner_id
  ) THEN
    RAISE EXCEPTION
      'connector permissions require jobs_owner to own Prisma history and public routines';
  END IF;
END
$$;

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
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'connector_user'
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
       OR roleid = connector_role_id
  ) THEN
    RAISE EXCEPTION
      'connector database role must not have role memberships';
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
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'connector_user'
)
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON DATABASE jobs_db FROM %I',
  :'connector_user'
)
\gexec

REVOKE ALL PRIVILEGES ON DATABASE jobs_db FROM PUBLIC;

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

REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;

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

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
  :'connector_user'
)
\gexec

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM %I',
  :'connector_user'
)
\gexec

REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;

-- PostgreSQL grants PUBLIC EXECUTE to newly-created functions by default.
-- Persist the deny for the actual migration/object owner so a migration added
-- after this provisioning run cannot silently bypass the exact allowlist.
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
  'jobs_owner'
)
\gexec

-- Table/sequence defaults currently grant nothing to PUBLIC, but revoke any
-- environment-specific defaults as part of the same future-object boundary.
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC',
  'jobs_owner'
)
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC',
  'jobs_owner'
)
\gexec

-- A schema-specific default ACL is added to the global default ACL rather than
-- replacing it. Revoke both planes so a pre-existing IN SCHEMA public grant
-- cannot restore PUBLIC access to a future migration object.
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
  'jobs_owner'
)
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC',
  'jobs_owner'
)
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC',
  'jobs_owner'
)
\gexec

-- The execution login receives no direct table DML. Each function below is a
-- fixed-search_path SECURITY DEFINER boundary with server-side tenant, lease,
-- version and state checks. Keep this allowlist exact after every migration.
SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.list_integration_credential_execution_kek_canaries(TEXT[])
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.list_due_integration_credential_validations(INTEGER)
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.claim_integration_credential_validation(UUID, TEXT, INTEGER)
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.finish_integration_credential_validation_job_failure(
      UUID, TEXT, UUID, INTEGER, TEXT, INTEGER
    )
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.finish_integration_credential_validation_provider_failure(
      UUID, TEXT, UUID, INTEGER, TEXT, TEXT, INTEGER
    )
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.finish_integration_credential_validation_success(
      UUID, TEXT, UUID, INTEGER, TEXT, JSONB
    )
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.authorize_rank_connector_execution_submit(
      UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT
    )
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.claim_rank_connector_submit_bounded(TEXT, INTEGER, TEXT)
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.read_rank_connector_submit_request(
      UUID, UUID, TEXT, UUID, INTEGER, INTEGER
    )
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.complete_rank_connector_submit(
      UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT,
      JSONB, BYTEA, TEXT
    )
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.claim_rank_connector_poll(TEXT, INTEGER, TEXT)
  TO %I',
  :'connector_user'
)
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION
    public.complete_rank_connector_poll(
      UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER,
      TIMESTAMPTZ, JSONB, BYTEA, TEXT
    )
  TO %I',
  :'connector_user'
)
\gexec

-- A PostgreSQL role is cluster-wide. REVOKE above intentionally touches only
-- jobs_db/public and must never mutate another service database. Instead,
-- reject an existing role if any direct ACL dependency remains outside the
-- exact jobs_db allowlist. pg_shdepend exposes ACL dependencies in every
-- database without connecting to them: database ACLs are shared pg_database
-- objects (dbid = 0), while local object/default ACLs carry their database
-- OID. PUBLIC grants use grantee OID 0 and therefore remain an independent
-- pg_hba/database-hardening concern.
DO $$
DECLARE
  connector_role_id OID;
  jobs_database_id OID;
  public_schema_id OID;
  allowed_routine_ids OID[];
BEGIN
  SELECT oid
  INTO connector_role_id
  FROM pg_roles
  WHERE rolname = current_setting('seo_platform.connector_user');

  SELECT oid
  INTO jobs_database_id
  FROM pg_database
  WHERE datname = current_database();

  SELECT oid
  INTO public_schema_id
  FROM pg_namespace
  WHERE nspname = 'public';

  allowed_routine_ids := ARRAY[
    'public.list_integration_credential_execution_kek_canaries(text[])'::regprocedure::oid,
    'public.list_due_integration_credential_validations(integer)'::regprocedure::oid,
    'public.claim_integration_credential_validation(uuid,text,integer)'::regprocedure::oid,
    'public.finish_integration_credential_validation_job_failure(uuid,text,uuid,integer,text,integer)'::regprocedure::oid,
    'public.finish_integration_credential_validation_provider_failure(uuid,text,uuid,integer,text,text,integer)'::regprocedure::oid,
    'public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)'::regprocedure::oid,
    'public.authorize_rank_connector_execution_submit(uuid,uuid,text,uuid,integer,integer,text)'::regprocedure::oid,
    'public.claim_rank_connector_submit_bounded(text,integer,text)'::regprocedure::oid,
    'public.read_rank_connector_submit_request(uuid,uuid,text,uuid,integer,integer)'::regprocedure::oid,
    'public.complete_rank_connector_submit(uuid,uuid,text,uuid,integer,integer,text,text,jsonb,bytea,text)'::regprocedure::oid,
    'public.claim_rank_connector_poll(text,integer,text)'::regprocedure::oid,
    'public.complete_rank_connector_poll(uuid,uuid,text,uuid,integer,integer,text,integer,timestamptz,jsonb,bytea,text)'::regprocedure::oid
  ];

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
      AND dependency.refobjid = connector_role_id
      AND dependency.deptype = 'a'
      AND (
        (
          dependency.dbid = 0
          AND (
            dependency.classid <> 'pg_database'::regclass
            OR shared_database.oid IS DISTINCT FROM jobs_database_id
          )
        )
        OR (
          dependency.dbid <> 0
          AND local_database.oid IS DISTINCT FROM jobs_database_id
        )
      )
  ) THEN
    RAISE EXCEPTION
      'connector database role must not have direct ACL outside jobs_db';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_shdepend dependency
    WHERE dependency.refclassid = 'pg_authid'::regclass
      AND dependency.refobjid = connector_role_id
      AND dependency.deptype = 'a'
      AND dependency.dbid = jobs_database_id
      AND NOT (
        (
          dependency.classid = 'pg_namespace'::regclass
          AND dependency.objid = public_schema_id
          AND dependency.objsubid = 0
        )
        OR (
          dependency.classid = 'pg_proc'::regclass
          AND dependency.objid = ANY (allowed_routine_ids)
          AND dependency.objsubid = 0
        )
      )
  ) THEN
    RAISE EXCEPTION
      'connector database role must not have direct ACL outside the exact jobs_db allowlist';
  END IF;

  -- The connector is implicitly a member of PUBLIC. Do not rewrite ACLs in
  -- another application-owned schema; fail closed on any effective CREATE or
  -- USAGE in a non-system schema. This stronger schema boundary also covers
  -- object kinds outside the table/sequence/routine/type catalogs, such as
  -- user-defined operators.
  IF EXISTS (
    SELECT 1
    FROM pg_namespace namespace
    WHERE namespace.nspname <> 'public'
      AND namespace.nspname <> 'pg_catalog'
      AND namespace.nspname <> 'information_schema'
      AND namespace.nspname NOT LIKE 'pg_toast%'
      AND namespace.nspname NOT LIKE 'pg_temp_%'
      AND (
        has_schema_privilege(
          connector_role_id,
          namespace.oid,
          'CREATE'
        )
        OR has_schema_privilege(
          connector_role_id,
          namespace.oid,
          'USAGE'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'connector database role must not inherit reachable PUBLIC privileges in non-system jobs_db schemas';
  END IF;
END
$$;

COMMIT;
