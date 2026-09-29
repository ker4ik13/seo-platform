BEGIN;

CREATE OR REPLACE FUNCTION public.list_remote_worker_rank_assignments(p_limit INTEGER)
RETURNS TABLE (
  "nodeId" TEXT,
  "jobId" UUID,
  "searchEngine" TEXT,
  "activeTasks" BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid worker assignment limit'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT CASE
      WHEN execution."lease_owner" ~ '^remote:[0-9a-f-]{36}:[0-9a-f-]{36}$'
        THEN split_part(execution."lease_owner", ':', 2)
      ELSE 'main' END,
    execution."job_id",
    CASE WHEN intent."request_snapshot" #>> '{execution,searchEngine}'
      IN ('YANDEX', 'GOOGLE')
      THEN intent."request_snapshot" #>> '{execution,searchEngine}'
      ELSE NULL END,
    COUNT(*)::bigint
  FROM public.rank_connector_executions execution
  JOIN public.rank_provider_request_intents intent
    ON intent."id" = execution."provider_request_intent_id"
    AND intent."workspace_id" = execution."workspace_id"
    AND intent."request_hash" = execution."provider_request_intent_hash"
  WHERE execution."status" IN ('SUBMITTING', 'FETCHING')
    AND execution."lease_expires_at" > clock_timestamp()
    AND execution."lease_owner" IS NOT NULL
  GROUP BY 1, 2, 3
  LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION public.list_remote_worker_rank_assignments(INTEGER)
  FROM PUBLIC;

COMMIT;
