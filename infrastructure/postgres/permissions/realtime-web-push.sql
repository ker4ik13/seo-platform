\set ON_ERROR_STOP on
\getenv worker_user REALTIME_WEB_PUSH_DATABASE_USER

BEGIN;

DO $$
DECLARE
  owner_id OID;
BEGIN
  IF current_database() <> 'realtime_db' THEN
    RAISE EXCEPTION
      'Web Push sender permissions must be provisioned in realtime_db';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper
  ) THEN
    RAISE EXCEPTION
      'Web Push sender role administration requires the cluster bootstrap administrator';
  END IF;
  SELECT oid INTO STRICT owner_id
  FROM pg_roles
  WHERE rolname = 'realtime_owner';
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = '_prisma_migrations'
      AND relation.relowner = owner_id
  ) THEN
    RAISE EXCEPTION
      'Web Push sender permissions require realtime_owner migration ownership';
  END IF;
END
$$;

SELECT set_config(
  'seo_platform.web_push_worker_user',
  :'worker_user',
  false
);

SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'worker_user'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'worker_user'
)
\gexec

DO $$
DECLARE
  worker_user TEXT :=
    current_setting('seo_platform.web_push_worker_user');
  worker_role_id OID;
BEGIN
  SELECT oid INTO STRICT worker_role_id
  FROM pg_roles
  WHERE rolname = worker_user;
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE oid = worker_role_id
      AND (
        rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
        OR rolreplication OR rolbypassrls
      )
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member = worker_role_id OR roleid = worker_role_id
  ) OR EXISTS (
    SELECT 1 FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = worker_role_id
      AND deptype = 'o'
  ) THEN
    RAISE EXCEPTION
      'Web Push sender database role must be unprivileged, membership-free and own no objects';
  END IF;
END
$$;

SELECT format(
  'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'worker_user'
)
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON DATABASE realtime_db FROM %I',
  :'worker_user'
)
\gexec
SELECT format(
  'GRANT CONNECT ON DATABASE realtime_db TO %I',
  :'worker_user'
)
\gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I',
  :'worker_user'
)
\gexec
SELECT format(
  'GRANT USAGE ON SCHEMA public TO %I',
  :'worker_user'
)
\gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
  :'worker_user'
)
\gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
  :'worker_user'
)
\gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM %I',
  :'worker_user'
)
\gexec

SELECT format(
  'GRANT SELECT ON TABLE public.notifications TO %I',
  :'worker_user'
)
\gexec
SELECT format(
  'GRANT SELECT ON TABLE public.web_push_encryption_key_canaries TO %I',
  :'worker_user'
)
\gexec
SELECT format(
  'GRANT SELECT ON TABLE public.web_push_fingerprint_key_canaries TO %I',
  :'worker_user'
)
\gexec
SELECT format(
  'GRANT SELECT ON TABLE public.web_push_delivery_attempts TO %I',
  :'worker_user'
)
\gexec
SELECT format(
  'GRANT UPDATE (
    status, attempt_count, available_at, lease_token, lease_expires_at,
    last_http_status, last_error_code, provider_message_id, delivered_at,
    terminal_at, updated_at
  ) ON TABLE public.web_push_delivery_attempts TO %I',
  :'worker_user'
)
\gexec
SELECT format(
  'GRANT SELECT ON TABLE public.web_push_subscriptions TO %I',
  :'worker_user'
)
\gexec
SELECT format(
  'GRANT UPDATE (
    status, status_reason, endpoint_fingerprint, material_fingerprint,
    material_ciphertext, material_nonce, material_auth_tag,
    encryption_key_version, fingerprint_key_version, provider_expires_at,
    last_delivery_status, last_delivery_at, last_delivery_error_code,
    revoked_at, expired_at, version, updated_at
  ) ON TABLE public.web_push_subscriptions TO %I',
  :'worker_user'
)
\gexec

COMMIT;
