BEGIN;

-- The submit runtime, normalized persistence and terminal finalization are
-- present at this point in the migration chain. Advance the immutable
-- kill-switch generation so executions created by the earlier default-closed
-- foundation can never become live retroactively.
UPDATE public.rank_connector_execution_controls
SET
  "submit_enabled" = TRUE,
  "kill_switch_version" = 'arsenkin-positions@2',
  "version" = "version" + 1,
  "updated_at" = GREATEST(
    clock_timestamp(),
    "updated_at" + interval '1 microsecond'
  )
WHERE "provider" = 'ARSENKIN'
  AND "capability" = 'SERP_RANK_TRACKING'
  AND NOT "submit_enabled"
  AND "execution_connector_version" = 'arsenkin-positions@1.0.0'
  AND "provider_policy_version" = 'manual-arsenkin-positions@1.0.0'
  AND "kill_switch_version" = 'arsenkin-positions@1'
  AND "version" = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.rank_connector_execution_controls
    WHERE "provider" = 'ARSENKIN'
      AND "capability" = 'SERP_RANK_TRACKING'
      AND "submit_enabled"
      AND "execution_connector_version" =
        'arsenkin-positions@1.0.0'
      AND "provider_policy_version" =
        'manual-arsenkin-positions@1.0.0'
      AND "kill_switch_version" = 'arsenkin-positions@2'
      AND "version" = 2
  ) THEN
    RAISE EXCEPTION
      'Arsenkin rank runtime activation precondition failed'
      USING ERRCODE = '55000';
  END IF;
END
$$;

COMMIT;
