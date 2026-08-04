BEGIN;

-- Do not reinterpret an automatically resumable request created for the
-- retired check-top adapter as a positions request. Operator-owned unknown
-- outcomes remain immutable and are intentionally outside automatic claim.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.rank_connector_executions
    WHERE "execution_connector_version" = 'arsenkin-positions@1.0.0'
      AND "status" IN (
        'READY_TO_SUBMIT',
        'CLAIMED',
        'SUBMITTING',
        'POLL_WAIT',
        'FETCHING',
        'STAGED',
        'PERSISTING',
        'FAILED_RETRYABLE'
      )
  ) THEN
    RAISE EXCEPTION
      'Arsenkin positions v2 activation requires old resumable executions to settle'
      USING ERRCODE = '55000';
  END IF;
END
$$;

UPDATE public.rank_connector_execution_controls
SET
  "execution_connector_version" = 'arsenkin-positions@2.0.0',
  "kill_switch_version" = 'arsenkin-positions@3',
  "version" = "version" + 1,
  "updated_at" = GREATEST(
    clock_timestamp(),
    "updated_at" + interval '1 microsecond'
  )
WHERE "provider" = 'ARSENKIN'
  AND "capability" = 'SERP_RANK_TRACKING'
  AND "submit_enabled"
  AND "execution_connector_version" = 'arsenkin-positions@1.0.0'
  AND "provider_policy_version" = 'manual-arsenkin-positions@1.0.0'
  AND "kill_switch_version" = 'arsenkin-positions@2'
  AND "version" = 2;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.rank_connector_execution_controls
    WHERE "provider" = 'ARSENKIN'
      AND "capability" = 'SERP_RANK_TRACKING'
      AND "submit_enabled"
      AND "execution_connector_version" = 'arsenkin-positions@2.0.0'
      AND "provider_policy_version" = 'manual-arsenkin-positions@1.0.0'
      AND "kill_switch_version" = 'arsenkin-positions@3'
      AND "version" = 3
  ) THEN
    RAISE EXCEPTION
      'Arsenkin positions v2 activation precondition failed'
      USING ERRCODE = '55000';
  END IF;
END
$$;

COMMIT;
