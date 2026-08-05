BEGIN;

CREATE FUNCTION public.manual_rank_action_result_is_coherent(
  result JSONB,
  pair_count BIGINT,
  persisted_count BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  result_pair_count BIGINT;
  result_persisted_count BIGINT;
  result_found_count BIGINT;
  result_not_found_count BIGINT;
  result_failed_count BIGINT;
  result_unknown_count BIGINT;
BEGIN
  IF result IS NULL
    OR jsonb_typeof(result) <> 'object'
    OR (
      SELECT count(*)
      FROM jsonb_object_keys(result)
    ) <> 6
    OR NOT result ?& ARRAY[
      'pairCount',
      'persistedCount',
      'foundCount',
      'notFoundCount',
      'failedCount',
      'submitOutcomeUnknownCount'
    ]
    OR EXISTS (
      SELECT 1
      FROM jsonb_each(result) entry
      WHERE jsonb_typeof(entry.value) <> 'string'
        OR entry.value #>> '{}' !~ '^(0|[1-9][0-9]{0,3})$'
    )
  THEN
    RETURN FALSE;
  END IF;

  result_pair_count := (result ->> 'pairCount')::BIGINT;
  result_persisted_count := (result ->> 'persistedCount')::BIGINT;
  result_found_count := (result ->> 'foundCount')::BIGINT;
  result_not_found_count := (result ->> 'notFoundCount')::BIGINT;
  result_failed_count := (result ->> 'failedCount')::BIGINT;
  result_unknown_count :=
    (result ->> 'submitOutcomeUnknownCount')::BIGINT;

  RETURN result_pair_count = pair_count
    AND result_persisted_count = persisted_count
    AND result_persisted_count =
      result_found_count + result_not_found_count
    AND result_pair_count =
      result_persisted_count +
      result_failed_count +
      result_unknown_count
    AND result_unknown_count > 0
    AND result_persisted_count < result_pair_count;
END
$$;

CREATE OR REPLACE FUNCTION public.assert_manual_rank_job_shape()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."type" <> 'MANUAL_RANK_CHECK' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW."status" <> 'PREPARING'
    OR NEW."version" <> 1
    OR NEW."attempt" <> 0
    OR NEW."progress_current" <> 0
    OR NEW."reserved_cost_micro" IS NOT NULL
    OR NEW."actual_cost_micro" IS NOT NULL
    OR NEW."error_summary" IS NOT NULL
    OR NEW."result_summary" IS NOT NULL
    OR NEW."cancel_requested_at" IS NOT NULL
    OR NEW."lease_owner" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."retry_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'MANUAL_RANK_CHECK must start in PREPARING version 1 attempt 0'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."project_id" IS NULL
    OR NEW."actor_id" IS NULL
    OR NEW."idempotency_key" IS NULL
    OR NEW."request_hash" IS NULL
    OR octet_length(NEW."request_hash") <> 32
    OR NEW."deduplication_key" IS NULL
    OR NEW."credential_mode" <> 'BYOK_API_KEY'
    OR NEW."provider" IS DISTINCT FROM 'ARSENKIN'
    OR NEW."progress_total" IS NULL
    OR NEW."progress_total" NOT BETWEEN 1 AND 1000
    OR NEW."progress_current" < 0
    OR NEW."progress_current" > NEW."progress_total"
    OR NEW."progress_unit" IS DISTINCT FROM 'KEYWORD'
    OR NEW."estimated_cost_micro" IS DISTINCT FROM 0
    OR NEW."currency" IS NULL
    OR NEW."max_attempts" NOT BETWEEN 1 AND 1000
    OR NEW."attempt" NOT BETWEEN 0 AND NEW."max_attempts"
  THEN
    RAISE EXCEPTION 'Invalid MANUAL_RANK_CHECK job shape'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" NOT IN (
    'PREPARING',
    'QUEUED',
    'RUNNING',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'PARTIALLY_COMPLETED',
    'COMPLETED',
    'FAILED_FINAL',
    'ACTION_REQUIRED',
    'EXPIRED'
  ) THEN
    RAISE EXCEPTION 'Unsupported MANUAL_RANK_CHECK job status'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'PREPARING' AND (
    NEW."stage" IS DISTINCT FROM 'PREPARING_SCOPE'
    OR NEW."queued_at" IS NOT NULL
    OR NEW."started_at" IS NOT NULL
    OR NEW."finished_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid PREPARING rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'QUEUED' AND (
    NEW."stage" IS DISTINCT FROM 'WAITING_FOR_QUEUE'
    OR NEW."queued_at" IS NULL
    OR NEW."started_at" IS NOT NULL
    OR NEW."finished_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid QUEUED rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'CANCEL_REQUESTED' AND (
    NEW."cancel_requested_at" IS NULL
    OR NEW."finished_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid CANCEL_REQUESTED rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IN (
    'CANCELLED',
    'PARTIALLY_COMPLETED',
    'COMPLETED',
    'FAILED_FINAL',
    'EXPIRED'
  ) AND (
    NEW."stage" IS DISTINCT FROM 'FINISHED'
    OR NEW."finished_at" IS NULL
    OR NEW."lease_owner" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."retry_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid terminal rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'ACTION_REQUIRED' AND (
    NEW."stage" IS DISTINCT FROM 'SUBMIT_OUTCOME_UNKNOWN'
    OR NEW."finished_at" IS NULL
    OR NEW."lease_owner" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."retry_at" IS NOT NULL
    OR NEW."error_summary"
      IS DISTINCT FROM '{"code":"SUBMIT_OUTCOME_UNKNOWN"}'::jsonb
    OR NOT public.manual_rank_action_result_is_coherent(
      NEW."result_summary",
      NEW."progress_total",
      NEW."progress_current"
    )
  ) THEN
    RAISE EXCEPTION 'Invalid ACTION_REQUIRED rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION
  public.manual_rank_action_result_is_coherent(JSONB, BIGINT, BIGINT)
FROM PUBLIC;

COMMIT;
