BEGIN;

-- Expired CLAIMED/FETCHING leases do not consume provider concurrency. They
-- must remain claimable so a transient worker lease loss cannot permanently
-- occupy all five provider slots.
CREATE OR REPLACE FUNCTION public.claim_rank_connector_submit_bounded(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER,
  p_execution_connector_version TEXT
)
RETURNS TABLE (
  "executionId" UUID,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ,
  "workspaceId" UUID,
  "provider" VARCHAR(64),
  "credentialId" UUID,
  "credentialMaterialVersion" INTEGER,
  "ciphertext" BYTEA,
  "nonce" BYTEA,
  "authTag" BYTEA,
  "encryptedDataKey" BYTEA,
  "dataKeyNonce" BYTEA,
  "dataKeyAuthTag" BYTEA,
  "keyVersion" INTEGER,
  "leaseGeneration" INTEGER,
  "executionVersion" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  provider_name VARCHAR(64);
  active_provider_tasks BIGINT;
BEGIN
  SELECT control.provider
  INTO provider_name
  FROM public.rank_connector_execution_controls control
  WHERE control.capability = 'SERP_RANK_TRACKING'
    AND control.execution_connector_version = p_execution_connector_version;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('seo-platform:rank-submit:' || provider_name, 0)
  ) THEN
    RETURN;
  END IF;

  SELECT
    (
      SELECT COUNT(*)
      FROM public.rank_connector_executions execution
      WHERE execution.provider = provider_name
        AND (
          execution.status IN ('SUBMITTING', 'POLL_WAIT')
          OR (
            execution.status = 'READY_TO_SUBMIT'
            AND execution.authorization_expires_at > clock_timestamp()
          )
          OR (
            execution.status = 'CLAIMED'
            AND execution.lease_expires_at > clock_timestamp()
          )
          OR (
            execution.status = 'FETCHING'
            AND execution.lease_expires_at > clock_timestamp()
          )
        )
    ) + (
      SELECT COUNT(DISTINCT frequency_job.id)
      FROM public.jobs frequency_job
      JOIN public.job_items item
        ON item.job_id = frequency_job.id
        AND item.workspace_id = frequency_job.workspace_id
        AND item.project_id = frequency_job.project_id
      WHERE frequency_job.type = 'FREQUENCY_COLLECTION'
        AND frequency_job.provider = provider_name
        AND (
          (
            frequency_job.status IN (
              'RUNNING',
              'RETRY_SCHEDULED',
              'WAITING_RATE_LIMIT',
              'FAILED_RETRYABLE'
            )
            AND item.status IN ('RUNNING', 'FAILED_RETRYABLE')
            AND item.provider_request_id IS NOT NULL
          )
          OR (
            frequency_job.status = 'ACTION_REQUIRED'
            AND item.provider_request_id ~ '^submitting:'
          )
        )
    )
  INTO active_provider_tasks;
  IF active_provider_tasks >= 5 THEN RETURN; END IF;

  RETURN QUERY
  SELECT *
  FROM public.claim_rank_connector_execution(
    p_lease_owner,
    p_lease_seconds,
    p_execution_connector_version
  );
END
$$;

REVOKE ALL ON FUNCTION public.claim_rank_connector_submit_bounded(
  TEXT,
  INTEGER,
  TEXT
) FROM PUBLIC;

COMMIT;
