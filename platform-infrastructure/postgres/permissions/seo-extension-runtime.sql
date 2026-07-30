\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF current_database() <> 'seo_db' THEN
    RAISE EXCEPTION
      'SEO extension permissions must be provisioned in seo_db';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = current_user
      AND rolsuper
  ) THEN
    RAISE EXCEPTION
      'SEO extension permissions require the cluster bootstrap administrator';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension extension_record
    WHERE extension_record.extname = 'pg_trgm'
      AND pg_get_userbyid(extension_record.extowner) = 'seo_owner'
  ) OR EXISTS (
    SELECT 1
    FROM pg_extension extension_record
    JOIN pg_namespace namespace
      ON namespace.oid = extension_record.extnamespace
    WHERE namespace.nspname = 'public'
      AND extension_record.extname <> 'pg_trgm'
  ) THEN
    RAISE EXCEPTION
      'SEO public extension allowlist or ownership has drifted';
  END IF;
END
$$;

SELECT format(
  'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC',
  routine.oid::regprocedure
)
FROM pg_proc routine
JOIN pg_depend dependency
  ON dependency.classid = 'pg_proc'::regclass
 AND dependency.objid = routine.oid
 AND dependency.deptype = 'e'
JOIN pg_extension extension_record
  ON extension_record.oid = dependency.refobjid
WHERE extension_record.extname = 'pg_trgm'
  AND routine.prokind = 'f'
ORDER BY routine.oid
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM seo_runtime',
  routine.oid::regprocedure
)
FROM pg_proc routine
JOIN pg_depend dependency
  ON dependency.classid = 'pg_proc'::regclass
 AND dependency.objid = routine.oid
 AND dependency.deptype = 'e'
JOIN pg_extension extension_record
  ON extension_record.oid = dependency.refobjid
WHERE extension_record.extname = 'pg_trgm'
  AND routine.prokind = 'f'
ORDER BY routine.oid
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO seo_runtime',
  routine.oid::regprocedure
)
FROM pg_proc routine
JOIN pg_depend dependency
  ON dependency.classid = 'pg_proc'::regclass
 AND dependency.objid = routine.oid
 AND dependency.deptype = 'e'
JOIN pg_extension extension_record
  ON extension_record.oid = dependency.refobjid
WHERE extension_record.extname = 'pg_trgm'
  AND routine.prokind = 'f'
ORDER BY routine.oid
\gexec

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc routine
    JOIN pg_depend dependency
      ON dependency.classid = 'pg_proc'::regclass
     AND dependency.objid = routine.oid
     AND dependency.deptype = 'e'
    JOIN pg_extension extension_record
      ON extension_record.oid = dependency.refobjid
    WHERE extension_record.extname = 'pg_trgm'
      AND routine.prokind = 'f'
      AND (
        NOT has_function_privilege(
          'seo_runtime',
          routine.oid,
          'EXECUTE'
        )
        OR EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'SEO pg_trgm runtime allowlist was not applied exactly';
  END IF;
END
$$;

COMMIT;
