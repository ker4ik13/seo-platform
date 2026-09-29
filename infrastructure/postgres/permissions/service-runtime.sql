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
CASE current_database()
  WHEN 'jobs_db' THEN 'jobs_rank_runtime'
  ELSE ''
END AS rank_runtime_role,
CASE current_database()
  WHEN 'jobs_db' THEN 'jobs_auth_email_runtime'
  ELSE ''
END AS auth_email_runtime_role,
current_database() AS database_name
\gset

SELECT set_config(
  'seo_platform.service_runtime_role',
  :'runtime_role',
  false
);
SELECT set_config(
  'seo_platform.jobs_rank_runtime_role',
  :'rank_runtime_role',
  false
);
SELECT set_config(
  'seo_platform.jobs_auth_email_runtime_role',
  :'auth_email_runtime_role',
  false
);

DO $$
DECLARE
  database_owner_id OID;
  expected_owner TEXT := current_setting('seo_platform.expected_owner', TRUE);
  role_id OID;
  role_name TEXT;
  runtime_roles TEXT[] := ARRAY[
    current_setting('seo_platform.service_runtime_role')
  ];
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

  IF current_database() = 'jobs_db' THEN
    runtime_roles := array_append(
      runtime_roles,
      current_setting('seo_platform.jobs_rank_runtime_role')
    );
    runtime_roles := array_append(
      runtime_roles,
      current_setting('seo_platform.jobs_auth_email_runtime_role')
    );
  END IF;

  FOREACH role_name IN ARRAY runtime_roles
  LOOP
    SELECT oid
    INTO STRICT role_id
    FROM pg_roles
    WHERE rolname = role_name;

    IF EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE oid = role_id
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
        'runtime service role % has unsafe attributes', role_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_auth_members
      WHERE member = role_id
         OR roleid = role_id
    ) THEN
      RAISE EXCEPTION
        'runtime service role % must not have membership edges', role_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_shdepend
      WHERE refclassid = 'pg_authid'::regclass
        AND refobjid = role_id
        AND deptype = 'o'
    ) THEN
      RAISE EXCEPTION
        'runtime service role % must not own database objects', role_name;
    END IF;
  END LOOP;

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
      AND NOT (
        current_database() = 'jobs_db'
        AND namespace.nspname = 'diagnostics'
      )
      AND namespace.nspname NOT LIKE 'pg_toast%'
      AND namespace.nspname NOT LIKE 'pg_temp_%'
  ) THEN
    RAISE EXCEPTION
      'service database contains an unexpected non-system schema';
  END IF;

  IF current_database() = 'jobs_db' AND EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'diagnostics'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_extension extension_record
      JOIN pg_namespace namespace
        ON namespace.oid = extension_record.extnamespace
      WHERE extension_record.extname = 'pg_stat_statements'
        AND namespace.nspname = 'diagnostics'
    ) OR has_schema_privilege('jobs_runtime', 'diagnostics', 'USAGE')
      OR has_schema_privilege('jobs_rank_runtime', 'diagnostics', 'USAGE')
      OR COALESCE(
        has_schema_privilege(to_regrole('jobs_connector'), 'diagnostics', 'USAGE'),
        false
      )
    THEN
      RAISE EXCEPTION 'query diagnostics schema is not isolated';
    END IF;
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

SELECT format(
  'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
  current_database(),
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO %I',
  current_database(),
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
  current_database(),
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO %I',
  current_database(),
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

REVOKE ALL PRIVILEGES ON SCHEMA public FROM :"runtime_role";
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"runtime_role";

SELECT format(
  'REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT USAGE ON SCHEMA public TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT USAGE ON SCHEMA public TO %I',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

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
  AND NOT (
    current_database() = 'jobs_db'
    AND relation.relname IN (
      'rank_provider_request_intents',
      'auth_email_delivery_attempts'
    )
  )
ORDER BY relation.oid
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT, INSERT, UPDATE ON TABLE public.auth_email_delivery_attempts TO %I',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT ON TABLE public.jobs TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT UPDATE (
    status,
    stage,
    progress_current,
    attempt,
    error_summary,
    result_summary,
    version,
    queued_at,
    started_at,
    finished_at,
    lease_owner,
    lease_expires_at,
    retry_at,
    updated_at
  ) ON TABLE public.jobs TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT, INSERT ON TABLE public.job_items TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT UPDATE (
    status,
    provider_request_id,
    output_reference,
    actual_cost_micro,
    error,
    attempt,
    retry_at,
    updated_at
  ) ON TABLE public.job_items TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT, UPDATE ON TABLE public.rank_job_runs TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT ON TABLE public.rank_estimates TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT, INSERT, UPDATE ON TABLE public.rank_execution_grant_attempts TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT, INSERT ON TABLE public.rank_provider_request_intents TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT, INSERT ON TABLE public.rank_connector_executions TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT (
    id,
    workspace_id,
    provider,
    mode,
    status,
    capabilities,
    material_version,
    version,
    verified_at,
    last_success_at,
    deleted_at
  ) ON TABLE public.integration_credentials TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT UPDATE (id) ON TABLE public.integration_credentials TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT ON TABLE public.project_connector_bindings TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT UPDATE (id) ON TABLE public.project_connector_bindings TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT SELECT ON TABLE public.project_connector_routes TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'GRANT UPDATE (id) ON TABLE public.project_connector_routes TO %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM :"runtime_role";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

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
  'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I',
  routine.oid::regprocedure,
  :'auth_email_runtime_role'
)
FROM pg_proc routine
JOIN pg_namespace namespace
  ON namespace.oid = routine.pronamespace
WHERE current_database() = 'jobs_db'
  AND namespace.nspname = 'public'
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
  'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I',
  routine.oid::regprocedure,
  :'rank_runtime_role'
)
FROM pg_proc routine
JOIN pg_namespace namespace
  ON namespace.oid = routine.pronamespace
WHERE current_database() = 'jobs_db'
  AND namespace.nspname = 'public'
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

-- Exact application routines required by direct runtime queries, CHECK
-- constraints or trigger WHEN predicates. Trigger procedures themselves
-- execute through their trigger and do not get a direct EXECUTE grant. Any
-- new callable routine must be reviewed here.
SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  routine_signature,
  :'runtime_role'
)
FROM unnest(CASE current_database()
  WHEN 'seo_db' THEN ARRAY[
    'public.rank_data_quality_flags_valid(jsonb)',
    'public.project_workspace_rekey_allowed(jsonb,jsonb)',
    'public.transfer_seo_project_workspace(uuid,uuid,uuid)'
  ]
  WHEN 'jobs_db' THEN ARRAY[
    'public.manual_rank_job_state_is_coherent(public."JobStatus",public."RankManifestSealState",public."RankCheckFinalStatus")',
    'public.manual_rank_action_result_is_coherent(jsonb,bigint,bigint)',
    'public.rank_execution_grant_request_is_exact(jsonb,uuid,uuid,uuid,uuid,integer,integer,bytea)',
    'public.rank_execution_grant_decision_is_exact(jsonb,text,bytea,bytea,timestamp with time zone,timestamp with time zone)',
    'public.list_integration_credential_key_versions()',
    'public.register_integration_credential_kek_canary(integer,bytea,bytea,bytea,bytea,bytea,bytea)',
    'public.read_rank_runtime_diagnostics_entries(uuid,uuid,uuid,integer)'
  ]
  ELSE ARRAY[]::TEXT[]
END) AS required_routine(routine_signature)
ORDER BY routine_signature
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  routine_signature,
  :'rank_runtime_role'
)
FROM unnest(ARRAY[
  'public.manual_rank_job_state_is_coherent(public."JobStatus",public."RankManifestSealState",public."RankCheckFinalStatus")',
  'public.manual_rank_action_result_is_coherent(jsonb,bigint,bigint)',
  'public.rank_execution_grant_request_is_exact(jsonb,uuid,uuid,uuid,uuid,integer,integer,bytea)',
  'public.rank_execution_grant_decision_is_exact(jsonb,text,bytea,bytea,timestamp with time zone,timestamp with time zone)',
  'public.claim_rank_staged_result(text,integer)',
  'public.claim_rank_staged_results(text,integer,integer)',
  'public.complete_rank_staged_result(uuid,uuid,text,uuid,integer,integer,boolean)'
]) AS rank_required_routine(routine_signature)
WHERE current_database() = 'jobs_db'
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

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I
    REVOKE ALL PRIVILEGES ON TABLES FROM %I',
  :'expected_owner',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I
    REVOKE ALL PRIVILEGES ON TABLES FROM %I',
  :'expected_owner',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
  :'expected_owner',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I
    REVOKE EXECUTE ON FUNCTIONS FROM %I',
  :'expected_owner',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
  :'expected_owner',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I
    REVOKE EXECUTE ON FUNCTIONS FROM %I',
  :'expected_owner',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

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

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM %I',
  :'expected_owner',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM %I',
  :'expected_owner',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
  :'expected_owner',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM %I',
  :'expected_owner',
  :'auth_email_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
  :'expected_owner',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM %I',
  :'expected_owner',
  :'rank_runtime_role'
)
WHERE current_database() = 'jobs_db'
\gexec

DO $$
DECLARE
  runtime_role_id OID := (
    SELECT oid
    FROM pg_roles
    WHERE rolname = current_setting('seo_platform.service_runtime_role')
  );
  rank_runtime_role_id OID := (
    SELECT oid
    FROM pg_roles
    WHERE rolname = NULLIF(
      current_setting('seo_platform.jobs_rank_runtime_role'),
      ''
    )
  );
  auth_email_runtime_role_id OID := (
    SELECT oid
    FROM pg_roles
    WHERE rolname = NULLIF(
      current_setting('seo_platform.jobs_auth_email_runtime_role'),
      ''
    )
  );
  role_id OID;
BEGIN
  FOREACH role_id IN ARRAY array_remove(
    ARRAY[
      runtime_role_id,
      rank_runtime_role_id,
      auth_email_runtime_role_id
    ],
    NULL
  )
  LOOP
    IF has_database_privilege(role_id, current_database(), 'CREATE')
      OR has_database_privilege(role_id, current_database(), 'TEMPORARY')
      OR has_schema_privilege(role_id, 'public', 'CREATE')
    THEN
      RAISE EXCEPTION
        'runtime service role retained DDL privileges';
    END IF;

    IF has_table_privilege(
      role_id,
      'public._prisma_migrations',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) THEN
      RAISE EXCEPTION
        'runtime service role must not access Prisma migration history';
    END IF;
  END LOOP;

  IF current_database() = 'jobs_db' THEN
    IF has_table_privilege(
      runtime_role_id,
      'public.auth_email_delivery_attempts',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) THEN
      RAISE EXCEPTION
        'generic jobs runtime must not access auth email delivery attempts';
    END IF;

    IF NOT has_table_privilege(
      auth_email_runtime_role_id,
      'public.auth_email_delivery_attempts',
      'SELECT'
    ) OR NOT has_table_privilege(
      auth_email_runtime_role_id,
      'public.auth_email_delivery_attempts',
      'INSERT'
    ) OR NOT has_table_privilege(
      auth_email_runtime_role_id,
      'public.auth_email_delivery_attempts',
      'UPDATE'
    ) OR has_table_privilege(
      auth_email_runtime_role_id,
      'public.auth_email_delivery_attempts',
      'DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) THEN
      RAISE EXCEPTION
        'auth email runtime must have only SELECT, INSERT and UPDATE on delivery attempts';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_class relation
      JOIN pg_namespace namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND relation.relname <> 'auth_email_delivery_attempts'
        AND has_table_privilege(
          auth_email_runtime_role_id,
          relation.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
    ) THEN
      RAISE EXCEPTION
        'auth email runtime must not access other jobs tables';
    END IF;

    IF has_table_privilege(
      runtime_role_id,
      'public.rank_provider_request_intents',
      'SELECT'
    ) OR has_table_privilege(
      runtime_role_id,
      'public.rank_provider_request_intents',
      'INSERT'
    ) OR has_table_privilege(
      runtime_role_id,
      'public.rank_provider_request_intents',
      'UPDATE'
    ) OR has_table_privilege(
      runtime_role_id,
      'public.rank_provider_request_intents',
      'DELETE'
    ) OR has_table_privilege(
      runtime_role_id,
      'public.rank_provider_request_intents',
      'TRUNCATE'
    ) OR has_table_privilege(
      runtime_role_id,
      'public.rank_provider_request_intents',
      'REFERENCES'
    ) OR has_table_privilege(
      runtime_role_id,
      'public.rank_provider_request_intents',
      'TRIGGER'
    ) THEN
      RAISE EXCEPTION
        'generic jobs runtime must not access rank provider request intents';
    END IF;

    IF NOT has_table_privilege(
      rank_runtime_role_id,
      'public.rank_provider_request_intents',
      'SELECT'
    ) OR NOT has_table_privilege(
      rank_runtime_role_id,
      'public.rank_provider_request_intents',
      'INSERT'
    ) OR has_table_privilege(
      rank_runtime_role_id,
      'public.rank_provider_request_intents',
      'UPDATE'
    ) OR has_table_privilege(
      rank_runtime_role_id,
      'public.rank_provider_request_intents',
      'DELETE'
    ) OR has_table_privilege(
      rank_runtime_role_id,
      'public.rank_provider_request_intents',
      'TRUNCATE'
    ) OR has_table_privilege(
      rank_runtime_role_id,
      'public.rank_provider_request_intents',
      'REFERENCES'
    ) OR has_table_privilege(
      rank_runtime_role_id,
      'public.rank_provider_request_intents',
      'TRIGGER'
    ) THEN
      RAISE EXCEPTION
        'rank runtime must have only SELECT and INSERT on provider request intents';
    END IF;
  END IF;
END
$$;

COMMIT;
