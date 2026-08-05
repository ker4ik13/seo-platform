BEGIN;

-- RLS is intentionally role-name based so the owner migration remains
-- deployable before the cluster bootstrap creates jobs_rank_runtime. The
-- canonical runtime role has NOINHERIT, no membership and never owns these
-- tables, so it cannot bypass the policies below.
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_connector_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_connector_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;

-- Existing owners/runtimes retain their pre-RLS behavior. Dedicated rank
-- policies are separate per command: a validation Job must be visible and
-- lockable with SELECT FOR UPDATE, but it must never be writable by rank.
CREATE POLICY "jobs_non_rank_runtime_all"
  ON public.jobs
  AS PERMISSIVE
  FOR ALL
  USING (current_user = 'jobs_runtime')
  WITH CHECK (current_user = 'jobs_runtime');

CREATE POLICY "jobs_rank_runtime_select"
  ON public.jobs
  AS PERMISSIVE
  FOR SELECT
  USING (
    current_user = 'jobs_rank_runtime'
    AND "type" IN (
      'MANUAL_RANK_CHECK',
      'INTEGRATION_CREDENTIAL_VALIDATE'
    )
  );

CREATE POLICY "jobs_rank_runtime_update"
  ON public.jobs
  AS PERMISSIVE
  FOR UPDATE
  USING (
    current_user = 'jobs_rank_runtime'
    AND "type" IN (
      'MANUAL_RANK_CHECK',
      'INTEGRATION_CREDENTIAL_VALIDATE'
    )
  )
  WITH CHECK (
    current_user = 'jobs_rank_runtime'
    AND "type" = 'MANUAL_RANK_CHECK'
  );

CREATE POLICY "job_items_non_rank_runtime_all"
  ON public.job_items
  AS PERMISSIVE
  FOR ALL
  USING (current_user = 'jobs_runtime')
  WITH CHECK (current_user = 'jobs_runtime');

CREATE POLICY "job_items_rank_runtime_select"
  ON public.job_items
  AS PERMISSIVE
  FOR SELECT
  USING (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.jobs parent_job
      WHERE parent_job."id" = job_items."job_id"
        AND parent_job."workspace_id" = job_items."workspace_id"
        AND parent_job."project_id"
          IS NOT DISTINCT FROM job_items."project_id"
        AND parent_job."type" = 'MANUAL_RANK_CHECK'
    )
  );

CREATE POLICY "job_items_rank_runtime_insert"
  ON public.job_items
  AS PERMISSIVE
  FOR INSERT
  WITH CHECK (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.jobs parent_job
      WHERE parent_job."id" = job_items."job_id"
        AND parent_job."workspace_id" = job_items."workspace_id"
        AND parent_job."project_id"
          IS NOT DISTINCT FROM job_items."project_id"
        AND parent_job."type" = 'MANUAL_RANK_CHECK'
    )
  );

CREATE POLICY "job_items_rank_runtime_update"
  ON public.job_items
  AS PERMISSIVE
  FOR UPDATE
  USING (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.jobs parent_job
      WHERE parent_job."id" = job_items."job_id"
        AND parent_job."workspace_id" = job_items."workspace_id"
        AND parent_job."project_id"
          IS NOT DISTINCT FROM job_items."project_id"
        AND parent_job."type" = 'MANUAL_RANK_CHECK'
    )
  )
  WITH CHECK (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.jobs parent_job
      WHERE parent_job."id" = job_items."job_id"
        AND parent_job."workspace_id" = job_items."workspace_id"
        AND parent_job."project_id"
          IS NOT DISTINCT FROM job_items."project_id"
        AND parent_job."type" = 'MANUAL_RANK_CHECK'
    )
  );

CREATE POLICY "project_connector_bindings_non_rank_runtime_all"
  ON public.project_connector_bindings
  AS PERMISSIVE
  FOR ALL
  USING (current_user = 'jobs_runtime')
  WITH CHECK (current_user = 'jobs_runtime');

CREATE POLICY "project_connector_bindings_rank_runtime_select"
  ON public.project_connector_bindings
  AS PERMISSIVE
  FOR SELECT
  USING (
    current_user = 'jobs_rank_runtime'
    AND "capability" = 'SERP_RANK_TRACKING'
  );

CREATE POLICY "project_connector_bindings_rank_runtime_update"
  ON public.project_connector_bindings
  AS PERMISSIVE
  FOR UPDATE
  USING (
    current_user = 'jobs_rank_runtime'
    AND "capability" = 'SERP_RANK_TRACKING'
  )
  WITH CHECK (
    current_user = 'jobs_rank_runtime'
    AND "capability" = 'SERP_RANK_TRACKING'
  );

CREATE POLICY "project_connector_routes_non_rank_runtime_all"
  ON public.project_connector_routes
  AS PERMISSIVE
  FOR ALL
  USING (current_user = 'jobs_runtime')
  WITH CHECK (current_user = 'jobs_runtime');

CREATE POLICY "project_connector_routes_rank_runtime_select"
  ON public.project_connector_routes
  AS PERMISSIVE
  FOR SELECT
  USING (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.project_connector_bindings binding
      WHERE binding."id" = project_connector_routes."binding_id"
        AND binding."workspace_id" =
          project_connector_routes."workspace_id"
        AND binding."project_id" = project_connector_routes."project_id"
        AND binding."capability" = 'SERP_RANK_TRACKING'
    )
  );

CREATE POLICY "project_connector_routes_rank_runtime_update"
  ON public.project_connector_routes
  AS PERMISSIVE
  FOR UPDATE
  USING (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.project_connector_bindings binding
      WHERE binding."id" = project_connector_routes."binding_id"
        AND binding."workspace_id" =
          project_connector_routes."workspace_id"
        AND binding."project_id" = project_connector_routes."project_id"
        AND binding."capability" = 'SERP_RANK_TRACKING'
    )
  )
  WITH CHECK (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.project_connector_bindings binding
      WHERE binding."id" = project_connector_routes."binding_id"
        AND binding."workspace_id" =
          project_connector_routes."workspace_id"
        AND binding."project_id" = project_connector_routes."project_id"
        AND binding."capability" = 'SERP_RANK_TRACKING'
    )
  );

CREATE POLICY "integration_credentials_non_rank_runtime_all"
  ON public.integration_credentials
  AS PERMISSIVE
  FOR ALL
  USING (current_user = 'jobs_runtime')
  WITH CHECK (current_user = 'jobs_runtime');

CREATE POLICY "integration_credentials_rank_runtime_select"
  ON public.integration_credentials
  AS PERMISSIVE
  FOR SELECT
  USING (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.project_connector_routes route
      JOIN public.project_connector_bindings binding
        ON binding."id" = route."binding_id"
       AND binding."workspace_id" = route."workspace_id"
       AND binding."project_id" = route."project_id"
      WHERE route."credential_id" = integration_credentials."id"
        AND route."workspace_id" =
          integration_credentials."workspace_id"
        AND binding."capability" = 'SERP_RANK_TRACKING'
    )
  );

CREATE POLICY "integration_credentials_rank_runtime_update"
  ON public.integration_credentials
  AS PERMISSIVE
  FOR UPDATE
  USING (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.project_connector_routes route
      JOIN public.project_connector_bindings binding
        ON binding."id" = route."binding_id"
       AND binding."workspace_id" = route."workspace_id"
       AND binding."project_id" = route."project_id"
      WHERE route."credential_id" = integration_credentials."id"
        AND route."workspace_id" =
          integration_credentials."workspace_id"
        AND binding."capability" = 'SERP_RANK_TRACKING'
    )
  )
  WITH CHECK (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.project_connector_routes route
      JOIN public.project_connector_bindings binding
        ON binding."id" = route."binding_id"
       AND binding."workspace_id" = route."workspace_id"
       AND binding."project_id" = route."project_id"
      WHERE route."credential_id" = integration_credentials."id"
        AND route."workspace_id" =
          integration_credentials."workspace_id"
        AND binding."capability" = 'SERP_RANK_TRACKING'
    )
  );

-- SELECT FOR UPDATE requires an UPDATE privilege. Keep it on the immutable ID
-- column only, and make every material ID change fail at the database layer.
CREATE FUNCTION public.reject_jobs_rank_runtime_id_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF current_user = 'jobs_rank_runtime'
    OR session_user = 'jobs_rank_runtime'
  THEN
    RAISE EXCEPTION
      'jobs_rank_runtime cannot update lock-only rows'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "job_items_rank_runtime_id_immutable"
  BEFORE UPDATE ON public.job_items
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_jobs_rank_runtime_id_update();

CREATE TRIGGER "integration_credentials_rank_runtime_id_immutable"
  BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_jobs_rank_runtime_id_update();

CREATE TRIGGER "project_connector_bindings_rank_runtime_id_immutable"
  BEFORE UPDATE ON public.project_connector_bindings
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_jobs_rank_runtime_id_update();

CREATE TRIGGER "project_connector_routes_rank_runtime_id_immutable"
  BEFORE UPDATE ON public.project_connector_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_jobs_rank_runtime_id_update();

-- The validation Job stays visible to the rank graph lock, but no UPDATE may
-- reach it, including a no-op write to an otherwise allowlisted column.
CREATE FUNCTION public.reject_jobs_rank_runtime_non_rank_job_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF (
      current_user = 'jobs_rank_runtime'
      OR session_user = 'jobs_rank_runtime'
    )
    AND (
      OLD."type" <> 'MANUAL_RANK_CHECK'
      OR NEW."type" <> 'MANUAL_RANK_CHECK'
    )
  THEN
    RAISE EXCEPTION
      'jobs_rank_runtime cannot update non-rank jobs'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "jobs_rank_runtime_domain_update_guard"
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION
    public.reject_jobs_rank_runtime_non_rank_job_update();

REVOKE ALL ON FUNCTION
  public.reject_jobs_rank_runtime_id_update()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.reject_jobs_rank_runtime_non_rank_job_update()
  FROM PUBLIC;

COMMIT;
