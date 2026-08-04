BEGIN;

ALTER TABLE public.project_connector_bindings
  ADD COLUMN "fallback_mode" VARCHAR(48) NOT NULL DEFAULT 'NONE',
  ADD COLUMN "fallback_reasons" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "configuration_scope" VARCHAR(32) NOT NULL DEFAULT 'PROJECT_OVERRIDE',
  ADD COLUMN "workspace_binding_id" UUID,
  ADD COLUMN "workspace_binding_version" INTEGER,
  ADD CONSTRAINT "project_connector_bindings_fallback_mode_valid"
    CHECK ("fallback_mode" IN (
      'NONE',
      'NEXT_AVAILABLE',
      'NEXT_AVAILABLE_THEN_WORKSPACE'
    ));

ALTER TABLE public.project_connector_routes
  ADD COLUMN "routing_scope" VARCHAR(32) NOT NULL DEFAULT 'PROJECT_OVERRIDE',
  ADD COLUMN "workspace_route_id" UUID,
  ADD CONSTRAINT "project_connector_routes_routing_scope_valid"
    CHECK ("routing_scope" IN ('PROJECT_OVERRIDE', 'WORKSPACE_DEFAULT', 'WORKSPACE_FALLBACK'));

CREATE INDEX "project_connector_routes_workspace_route_idx"
  ON public.project_connector_routes ("workspace_id", "workspace_route_id")
  WHERE "workspace_route_id" IS NOT NULL;

CREATE TABLE public.workspace_connector_bindings (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "capability" VARCHAR(100) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "fallback_mode" VARCHAR(48) NOT NULL DEFAULT 'NONE',
  "fallback_reasons" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "workspace_connector_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_connector_bindings_capability_not_blank"
    CHECK (length(btrim("capability")) > 0),
  CONSTRAINT "workspace_connector_bindings_version_positive"
    CHECK ("version" > 0),
  CONSTRAINT "workspace_connector_bindings_fallback_mode_valid"
    CHECK ("fallback_mode" IN ('NONE', 'NEXT_AVAILABLE'))
);

CREATE TABLE public.workspace_connector_routes (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "binding_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "credential_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "workspace_connector_routes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_connector_routes_position_bounded"
    CHECK ("position" BETWEEN 0 AND 7)
);

CREATE UNIQUE INDEX "workspace_connector_bindings_workspace_capability_key"
  ON public.workspace_connector_bindings ("workspace_id", "capability");
CREATE UNIQUE INDEX "workspace_connector_bindings_workspace_id_key"
  ON public.workspace_connector_bindings ("workspace_id", "id");
CREATE INDEX "workspace_connector_bindings_workspace_created_idx"
  ON public.workspace_connector_bindings ("workspace_id", "created_at", "id");
CREATE UNIQUE INDEX "workspace_connector_routes_workspace_binding_position_key"
  ON public.workspace_connector_routes ("workspace_id", "binding_id", "position");
CREATE UNIQUE INDEX "workspace_connector_routes_workspace_binding_credential_key"
  ON public.workspace_connector_routes ("workspace_id", "binding_id", "credential_id");
CREATE INDEX "workspace_connector_routes_workspace_credential_idx"
  ON public.workspace_connector_routes ("workspace_id", "credential_id");

ALTER TABLE public.workspace_connector_routes
  ADD CONSTRAINT "workspace_connector_routes_binding_workspace_fkey"
    FOREIGN KEY ("workspace_id", "binding_id")
    REFERENCES public.workspace_connector_bindings ("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT "workspace_connector_routes_credential_workspace_fkey"
    FOREIGN KEY ("workspace_id", "credential_id")
    REFERENCES public.integration_credentials ("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE public.project_connector_bindings
  ADD CONSTRAINT "project_connector_bindings_configuration_scope_valid"
    CHECK ("configuration_scope" IN ('PROJECT_OVERRIDE', 'WORKSPACE_INHERITED')),
  ADD CONSTRAINT "project_connector_bindings_workspace_snapshot_valid"
    CHECK (
      ("configuration_scope" = 'PROJECT_OVERRIDE' AND "workspace_binding_id" IS NULL AND "workspace_binding_version" IS NULL)
      OR
      ("configuration_scope" = 'WORKSPACE_INHERITED' AND "workspace_binding_id" IS NOT NULL AND "workspace_binding_version" IS NOT NULL AND "workspace_binding_version" > 0)
    ),
  ADD CONSTRAINT "project_connector_bindings_workspace_binding_fkey"
    FOREIGN KEY ("workspace_id", "workspace_binding_id")
    REFERENCES public.workspace_connector_bindings ("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE public.workspace_connector_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_connector_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_connector_bindings_jobs_runtime_all"
  ON public.workspace_connector_bindings
  AS PERMISSIVE FOR ALL
  USING (current_user = 'jobs_runtime')
  WITH CHECK (current_user = 'jobs_runtime');

CREATE POLICY "workspace_connector_bindings_rank_runtime_select"
  ON public.workspace_connector_bindings
  AS PERMISSIVE FOR SELECT
  USING (
    current_user = 'jobs_rank_runtime'
    AND "capability" = 'SERP_RANK_TRACKING'
  );

CREATE POLICY "workspace_connector_routes_jobs_runtime_all"
  ON public.workspace_connector_routes
  AS PERMISSIVE FOR ALL
  USING (current_user = 'jobs_runtime')
  WITH CHECK (current_user = 'jobs_runtime');

CREATE POLICY "workspace_connector_routes_rank_runtime_select"
  ON public.workspace_connector_routes
  AS PERMISSIVE FOR SELECT
  USING (
    current_user = 'jobs_rank_runtime'
    AND EXISTS (
      SELECT 1
      FROM public.workspace_connector_bindings binding
      WHERE binding."workspace_id" = workspace_connector_routes."workspace_id"
        AND binding."id" = workspace_connector_routes."binding_id"
        AND binding."capability" = 'SERP_RANK_TRACKING'
    )
  );

COMMIT;
