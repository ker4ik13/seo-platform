BEGIN;

ALTER TABLE public.project_connector_routes
  ADD COLUMN retired_at TIMESTAMPTZ(6);

DROP INDEX public.project_connector_routes_tenant_project_binding_position_key;

CREATE UNIQUE INDEX project_connector_routes_tenant_project_binding_position_key
  ON public.project_connector_routes (
    workspace_id,
    project_id,
    binding_id,
    position
  )
  WHERE retired_at IS NULL;

CREATE INDEX project_connector_routes_tenant_retired_idx
  ON public.project_connector_routes (
    workspace_id,
    project_id,
    binding_id,
    retired_at
  );

COMMIT;
