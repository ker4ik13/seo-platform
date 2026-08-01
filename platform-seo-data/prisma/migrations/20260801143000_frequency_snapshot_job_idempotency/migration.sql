BEGIN;

ALTER TABLE public.frequency_snapshots
  ADD COLUMN device VARCHAR(32) NOT NULL DEFAULT 'ALL',
  ADD COLUMN period VARCHAR(32),
  ADD COLUMN quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT frequency_snapshots_device_valid CHECK (
    device IN ('ALL', 'DESKTOP', 'MOBILE', 'PHONE_ONLY', 'TABLET_ONLY')
  ),
  ADD CONSTRAINT frequency_snapshots_period_valid CHECK (
    period IS NULL OR period ~ '^[0-9A-Za-z._:-]{1,32}$'
  ),
  ADD CONSTRAINT frequency_snapshots_quality_flags_array CHECK (
    jsonb_typeof(quality_flags) = 'array'
    AND jsonb_array_length(quality_flags) <= 4
    AND quality_flags <@ '["CONTEXT_INCOMPLETE","STALE","PARTIAL","ESTIMATED"]'::jsonb
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.frequency_snapshots
    GROUP BY workspace_id, project_id, job_id, keyword_id, type, region_code, device
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Resolve duplicate frequency snapshots before applying Job idempotency';
  END IF;
END
$$;

DROP INDEX public.frequency_snapshots_project_id_keyword_id_type_region_code__idx;

CREATE INDEX frequency_snapshots_keyword_context_observed_idx
  ON public.frequency_snapshots(
    project_id,
    keyword_id,
    type,
    region_code,
    device,
    observed_at
  );

CREATE UNIQUE INDEX frequency_snapshots_job_keyword_context_key
  ON public.frequency_snapshots(
    workspace_id,
    project_id,
    job_id,
    keyword_id,
    type,
    region_code,
    device
  );

COMMIT;
