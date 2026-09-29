BEGIN;

-- The expensive, fairness-ordered search is performed once per bounded batch.
-- These IDs are hints, not leases: the existing claim graph remains the only
-- authority to start a paid request. No credential material leaves the broker.
CREATE FUNCTION public.list_rank_connector_submit_candidates(
  p_execution_connector_version TEXT,
  p_lease_seconds INTEGER,
  p_limit INTEGER,
  p_excluded UUID[]
)
RETURNS TABLE ("executionId" UUID, "jobId" UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_execution_connector_version IS NULL
    OR p_execution_connector_version !~ '^[a-z0-9][a-z0-9@._-]{0,63}$'
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 120
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30
    OR p_excluded IS NULL OR cardinality(p_excluded) > 120
  THEN
    RAISE EXCEPTION 'Invalid rank submit candidate request'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rank_connector_executions execution
    WHERE execution.execution_connector_version = p_execution_connector_version
      AND execution.authorization_expires_at >
        clock_timestamp() + make_interval(secs => p_lease_seconds)
      AND (
        execution.status = 'READY_TO_SUBMIT'
        OR (execution.status = 'CLAIMED'
          AND execution.lease_expires_at <= clock_timestamp())
      )
    LIMIT 1
  ) THEN RETURN; END IF;

  RETURN QUERY
  WITH eligible AS MATERIALIZED (
    SELECT execution.id, execution.job_id, execution.credential_id,
           execution.project_id, execution.provider, execution.created_at,
           row_number() OVER (
             PARTITION BY execution.credential_id, execution.project_id,
                          execution.job_id
             ORDER BY execution.created_at, execution.id
           ) AS job_turn
    FROM public.rank_connector_executions execution
    JOIN public.jobs job
      ON job.workspace_id = execution.workspace_id
     AND job.project_id = execution.project_id
     AND job.id = execution.job_id
    JOIN public.rank_connector_execution_controls control
      ON control.provider = execution.provider
     AND control.capability = 'SERP_RANK_TRACKING'
    WHERE execution.provider = 'XMLSTOCK'
      AND execution.id <> ALL(p_excluded)
      AND execution.execution_connector_version = p_execution_connector_version
      AND control.execution_connector_version = p_execution_connector_version
      AND control.submit_enabled
      AND job.type = 'MANUAL_RANK_CHECK'
      AND job.provider = execution.provider
      AND job.version = execution.job_version
      AND job.cancel_requested_at IS NULL
      AND (
        (job.status = 'QUEUED' AND job.stage = 'WAITING_FOR_QUEUE')
        OR (job.status = 'RUNNING' AND job.stage = 'WAITING_EXECUTION_GRANT')
      )
      AND execution.authorization_expires_at >
        clock_timestamp() + make_interval(secs => p_lease_seconds)
      AND (
        execution.status = 'READY_TO_SUBMIT'
        OR (execution.status = 'CLAIMED'
          AND execution.lease_expires_at <= clock_timestamp())
      )
  ), active AS MATERIALIZED (
    SELECT execution.credential_id, execution.project_id,
           execution.provider, COUNT(*) AS active_count
    FROM public.rank_connector_executions execution
    WHERE execution.provider = 'XMLSTOCK'
      AND (
        execution.status = 'SUBMITTING'
        OR (execution.status IN ('CLAIMED', 'FETCHING')
          AND execution.lease_expires_at > clock_timestamp())
      )
    GROUP BY execution.credential_id, execution.project_id,
             execution.provider
  )
  SELECT eligible.id, eligible.job_id
  FROM eligible
  LEFT JOIN active
    ON active.credential_id = eligible.credential_id
   AND active.project_id = eligible.project_id
   AND active.provider = eligible.provider
  ORDER BY COALESCE(active.active_count, 0), eligible.job_turn,
           eligible.created_at, eligible.id
  LIMIT p_limit;
END
$$;

-- Reuse the exact canonical graph/lock/transition implementation, replacing
-- only candidate discovery with a primary-key lookup. The migration fails
-- closed if the original definition has drifted from the reviewed shape.
DO $migration$
DECLARE
  definition TEXT;
  original_header CONSTANT TEXT :=
    'claim_rank_connector_execution_pre_authorization(p_lease_owner text, p_lease_seconds integer, p_execution_connector_version text)';
  targeted_header CONSTANT TEXT :=
    'claim_rank_connector_execution_pre_authorization_targeted(p_lease_owner text, p_lease_seconds integer, p_execution_connector_version text, p_execution_id uuid)';
  original_filter CONSTANT TEXT := 'WHERE control."submit_enabled"';
  targeted_filter CONSTANT TEXT :=
    'WHERE execution."id" = p_execution_id AND control."submit_enabled"';
  precheck_start INTEGER;
  candidate_start INTEGER;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution_pre_authorization(text,integer,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, original_header, '')))
      / length(original_header) <> 1
    OR (length(definition) - length(replace(definition, original_filter, '')))
      / length(original_filter) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected rank submit graph before targeted claim'
      USING ERRCODE = '55000';
  END IF;

  -- The global idle precheck belongs to the untargeted tick. Repeating it for
  -- every primary-key claim would reintroduce the very scan being removed.
  precheck_start := strpos(
    definition, '  -- Most ticks arrive while there is no due work.'
  );
  candidate_start := strpos(
    definition, '  -- Candidate discovery does not lock a child row first.'
  );
  IF precheck_start = 0 OR candidate_start <= precheck_start THEN
    RAISE EXCEPTION 'Unexpected rank submit precheck before targeted claim'
      USING ERRCODE = '55000';
  END IF;
  definition := substring(definition FROM 1 FOR precheck_start - 1)
    || substring(definition FROM candidate_start);

  EXECUTE replace(
    replace(definition, original_header, targeted_header),
    original_filter,
    targeted_filter
  );
END
$migration$;

CREATE FUNCTION public.claim_rank_connector_submit_targeted(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER,
  p_execution_connector_version TEXT,
  p_execution_id UUID
)
RETURNS TABLE (
  "executionId" UUID, "leaseToken" UUID, "leaseExpiresAt" TIMESTAMPTZ,
  "workspaceId" UUID, provider VARCHAR(64), "credentialId" UUID,
  "credentialMaterialVersion" INTEGER, ciphertext BYTEA, nonce BYTEA,
  "authTag" BYTEA, "encryptedDataKey" BYTEA, "dataKeyNonce" BYTEA,
  "dataKeyAuthTag" BYTEA, "keyVersion" INTEGER,
  "leaseGeneration" INTEGER, "executionVersion" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  claimed RECORD;
  claimed_generation INTEGER;
  claimed_version INTEGER;
BEGIN
  IF p_execution_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.rank_connector_execution_controls control
    WHERE control.capability = 'SERP_RANK_TRACKING'
      AND control.provider = 'XMLSTOCK'
      AND control.execution_connector_version = p_execution_connector_version
  ) THEN
    RETURN;
  END IF;

  SELECT claim.* INTO claimed
  FROM public.claim_rank_connector_execution_pre_authorization_targeted(
    p_lease_owner, p_lease_seconds, p_execution_connector_version,
    p_execution_id
  ) claim;
  IF NOT FOUND THEN RETURN; END IF;

  -- A new statement sees the row changed by the volatile claim function.
  SELECT execution.lease_generation, execution.version
  INTO claimed_generation, claimed_version
  FROM public.rank_connector_executions execution
  WHERE execution.id = claimed."executionId"
    AND execution.lease_token = claimed."leaseToken"
    AND execution.status = 'CLAIMED';
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY SELECT
    claimed."executionId"::UUID, claimed."leaseToken"::UUID,
    claimed."leaseExpiresAt"::TIMESTAMPTZ, claimed."workspaceId"::UUID,
    claimed.provider::VARCHAR(64), claimed."credentialId"::UUID,
    claimed."credentialMaterialVersion"::INTEGER, claimed.ciphertext::BYTEA,
    claimed.nonce::BYTEA, claimed."authTag"::BYTEA,
    claimed."encryptedDataKey"::BYTEA, claimed."dataKeyNonce"::BYTEA,
    claimed."dataKeyAuthTag"::BYTEA, claimed."keyVersion"::INTEGER,
    claimed_generation, claimed_version;
END
$$;

REVOKE ALL ON FUNCTION public.list_rank_connector_submit_candidates(TEXT, INTEGER, INTEGER, UUID[])
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_rank_connector_execution_pre_authorization_targeted(
  TEXT, INTEGER, TEXT, UUID
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_rank_connector_submit_targeted(
  TEXT, INTEGER, TEXT, UUID
) FROM PUBLIC;

COMMIT;
