BEGIN;

-- General Jobs HTTP deliberately cannot read the private immutable provider
-- request-intent table.  Runtime diagnostics needs only a small, redacted
-- projection, so expose that projection through an owner-owned routine rather
-- than widening table privileges.
CREATE FUNCTION public.read_rank_runtime_diagnostics_entries(
  p_workspace_id UUID,
  p_project_id UUID,
  p_job_id UUID,
  p_limit INTEGER
)
RETURNS TABLE (
  sequence INTEGER,
  keyword TEXT,
  status TEXT,
  execution_attempt INTEGER,
  submit_attempts INTEGER,
  poll_attempts INTEGER,
  next_action_at TIMESTAMPTZ,
  provider_progress JSONB,
  error_code TEXT,
  active BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  WITH latest AS (
    SELECT DISTINCT ON (execution.job_item_id)
      item.sequence,
      intent.request_snapshot -> 'keywords' -> 0 ->> 'keywordText'
        AS keyword,
      execution.status::TEXT AS status,
      execution.execution_attempt,
      execution.submit_attempt_count AS submit_attempts,
      execution.poll_attempt_count AS poll_attempts,
      execution.next_action_at,
      execution.provider_progress_snapshot AS provider_progress,
      execution.last_error_code::TEXT AS error_code,
      execution.lease_owner IS NOT NULL
        AND execution.lease_expires_at > statement_timestamp()
        AND execution.status IN ('CLAIMED', 'SUBMITTING', 'FETCHING')
        AS active,
      execution.updated_at
    FROM public.rank_connector_executions execution
    JOIN public.job_items item
      ON item.workspace_id = execution.workspace_id
     AND item.project_id = execution.project_id
     AND item.job_id = execution.job_id
     AND item.id = execution.job_item_id
    JOIN public.rank_provider_request_intents intent
      ON intent.workspace_id = execution.workspace_id
     AND intent.project_id = execution.project_id
     AND intent.job_id = execution.job_id
     AND intent.job_item_id = execution.job_item_id
     AND intent.id = execution.provider_request_intent_id
    WHERE execution.workspace_id = p_workspace_id
      AND execution.project_id = p_project_id
      AND execution.job_id = p_job_id
      AND execution.provider = 'XMLSTOCK'
    ORDER BY
      execution.job_item_id,
      execution.execution_attempt DESC,
      execution.id DESC
  )
  SELECT
    latest.sequence,
    latest.keyword,
    latest.status,
    latest.execution_attempt,
    latest.submit_attempts,
    latest.poll_attempts,
    latest.next_action_at,
    latest.provider_progress,
    latest.error_code,
    latest.active,
    latest.updated_at
  FROM latest
  ORDER BY latest.updated_at DESC, latest.sequence ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 250)
$function$;

COMMENT ON FUNCTION public.read_rank_runtime_diagnostics_entries(
  UUID,
  UUID,
  UUID,
  INTEGER
) IS
  'Tenant-scoped, redacted XMLStock rank diagnostics projection. Never returns credential, provider request or physical worker identity.';

REVOKE ALL ON FUNCTION public.read_rank_runtime_diagnostics_entries(
  UUID,
  UUID,
  UUID,
  INTEGER
) FROM PUBLIC;

DO $acl$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'jobs_runtime'
  ) THEN
    EXECUTE
      'GRANT EXECUTE ON FUNCTION public.read_rank_runtime_diagnostics_entries(UUID, UUID, UUID, INTEGER) TO jobs_runtime';
  END IF;
END
$acl$;

COMMIT;
