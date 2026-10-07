ALTER TABLE public.jobs
  ADD COLUMN provider_progress_percent SMALLINT;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_provider_progress_percent_check
  CHECK (provider_progress_percent BETWEEN 0 AND 100);

-- Keep the six-argument routine for workers being replaced during rollout.
-- The new wrapper uses the existing fenced transition and writes only when
-- Arsenkin reports a different progress value for the current provider task.
CREATE FUNCTION public.defer_ai_answer_collection_batch(
  p_job_id UUID, p_job_item_ids UUID[], p_lease_owner TEXT,
  p_job_version INTEGER, p_provider_request_id TEXT,
  p_retry_after_seconds INTEGER, p_progress_percent INTEGER,
  p_reset_progress BOOLEAN
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  completed_job_id UUID;
  completed_version INTEGER;
  next_progress SMALLINT;
BEGIN
  IF p_reset_progress IS NULL
     OR (p_progress_percent IS NOT NULL AND p_progress_percent NOT BETWEEN 0 AND 100)
     OR (p_reset_progress AND p_progress_percent IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'invalid AI answer provider progress' USING ERRCODE = '22023';
  END IF;

  SELECT deferred."jobId", deferred."jobVersion"
    INTO completed_job_id, completed_version
  FROM public.defer_ai_answer_collection_batch(
    p_job_id, p_job_item_ids, p_lease_owner, p_job_version,
    p_provider_request_id, p_retry_after_seconds
  ) deferred;
  IF completed_job_id IS NULL THEN RETURN; END IF;

  next_progress := CASE
    WHEN p_reset_progress THEN 0
    ELSE p_progress_percent::SMALLINT
  END;
  IF next_progress IS NOT NULL THEN
    UPDATE public.jobs job
    SET provider_progress_percent = CASE
      WHEN p_reset_progress THEN next_progress
      ELSE GREATEST(COALESCE(job.provider_progress_percent, 0), next_progress)
    END
    WHERE job.id = completed_job_id
      AND job.version = completed_version
      AND job.type = 'AI_ANSWER_COLLECTION'
      AND job.status = 'RETRY_SCHEDULED'
      AND job.stage = 'provider_poll'
      AND job.provider_progress_percent IS DISTINCT FROM CASE
        WHEN p_reset_progress THEN next_progress
        ELSE GREATEST(COALESCE(job.provider_progress_percent, 0), next_progress)
      END;
  END IF;

  RETURN QUERY SELECT completed_job_id, completed_version;
END
$$;

REVOKE ALL ON FUNCTION public.defer_ai_answer_collection_batch(
  UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER, INTEGER, BOOLEAN
) FROM PUBLIC;
