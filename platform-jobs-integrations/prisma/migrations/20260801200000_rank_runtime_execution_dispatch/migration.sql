BEGIN;

-- The isolated rank worker owns the QUEUED -> RUNNING transition. The
-- original column ACL covered every other lifecycle field but omitted the
-- immutable first-start timestamp used by that transition.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'jobs_rank_runtime'
  ) THEN
    GRANT UPDATE (started_at)
      ON TABLE public.jobs
      TO jobs_rank_runtime;
  END IF;
END
$$;

COMMIT;
