BEGIN;

SET LOCAL lock_timeout = '5s';

-- The dedicated rank role receives UPDATE(id) only so SELECT FOR UPDATE can
-- lock dependency rows. The original row-level trigger ran for every UPDATE
-- and therefore also rejected the separately allowlisted rank-domain fields.
-- Scope the guard to material ID writes while keeping every ID write denied.
DROP TRIGGER "job_items_rank_runtime_id_immutable"
  ON public.job_items;
CREATE TRIGGER "job_items_rank_runtime_id_immutable"
  BEFORE UPDATE OF id ON public.job_items
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_jobs_rank_runtime_id_update();

DROP TRIGGER "integration_credentials_rank_runtime_id_immutable"
  ON public.integration_credentials;
CREATE TRIGGER "integration_credentials_rank_runtime_id_immutable"
  BEFORE UPDATE OF id ON public.integration_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_jobs_rank_runtime_id_update();

DROP TRIGGER "project_connector_bindings_rank_runtime_id_immutable"
  ON public.project_connector_bindings;
CREATE TRIGGER "project_connector_bindings_rank_runtime_id_immutable"
  BEFORE UPDATE OF id ON public.project_connector_bindings
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_jobs_rank_runtime_id_update();

DROP TRIGGER "project_connector_routes_rank_runtime_id_immutable"
  ON public.project_connector_routes;
CREATE TRIGGER "project_connector_routes_rank_runtime_id_immutable"
  BEFORE UPDATE OF id ON public.project_connector_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_jobs_rank_runtime_id_update();

COMMIT;
