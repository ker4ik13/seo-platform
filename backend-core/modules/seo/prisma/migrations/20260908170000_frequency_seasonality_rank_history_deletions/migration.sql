BEGIN;

CREATE TABLE "rank_dimension_history_deletions" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "search_engine" VARCHAR(16) NOT NULL,
  "country_code" CHAR(2) NOT NULL,
  "region_code" VARCHAR(100) NOT NULL,
  "language" VARCHAR(16) NOT NULL,
  "device" VARCHAR(16) NOT NULL,
  "excluded_through" TIMESTAMPTZ(6) NOT NULL,
  "deleted_by" UUID NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "affected_snapshot_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rank_dimension_history_deletions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rank_dimension_history_delet_additive_scope" CHECK (
    "search_engine" IN ('YANDEX', 'GOOGLE')
    AND "country_code" ~ '^[A-Z]{2}$'
    AND length("region_code") BETWEEN 1 AND 100
    AND length("language") BETWEEN 2 AND 16
    AND "device" IN ('DESKTOP', 'MOBILE')
    AND octet_length("request_hash") = 32
    AND "affected_snapshot_count" >= 0
  )
);
CREATE UNIQUE INDEX "rank_dimension_history_deletions_idempotency_key"
  ON "rank_dimension_history_deletions"("workspace_id", "idempotency_key");
CREATE INDEX "rank_dimension_history_deletions_dimension_idx"
  ON "rank_dimension_history_deletions"(
    "workspace_id", "project_id", "search_engine", "country_code",
    "region_code", "language", "device", "excluded_through" DESC
  );

CREATE TABLE "frequency_seasonality_points" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "keyword_id" UUID NOT NULL,
  "granularity" VARCHAR(16) NOT NULL,
  "period_start" DATE NOT NULL,
  "value" BIGINT NOT NULL,
  "share" DECIMAL(24,18),
  "region_code" VARCHAR(100) NOT NULL,
  "device" VARCHAR(32) NOT NULL DEFAULT 'ALL',
  "provider" VARCHAR(64) NOT NULL,
  "source_mode" "DataSourceMode" NOT NULL,
  "job_id" UUID NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "frequency_seasonality_points_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "frequency_seasonality_points_shape" CHECK (
    "granularity" IN ('MONTH', 'WEEK', 'DAY')
    AND "value" >= 0
    AND ("share" IS NULL OR ("share" >= 0 AND "share" <= 1))
    AND length("region_code") BETWEEN 1 AND 100
    AND "device" IN ('ALL', 'DESKTOP', 'MOBILE', 'PHONE_ONLY', 'TABLET_ONLY')
    AND "provider" IN ('XMLSTOCK', 'ARSENKIN')
    AND "source_mode" IN ('BYOK', 'PLATFORM')
  )
);
CREATE UNIQUE INDEX "frequency_seasonality_points_job_keyword_period_key"
  ON "frequency_seasonality_points"(
    "workspace_id", "project_id", "job_id", "keyword_id", "granularity",
    "period_start", "region_code", "device"
  );
CREATE INDEX "frequency_seasonality_points_keyword_period_idx"
  ON "frequency_seasonality_points"(
    "workspace_id", "project_id", "keyword_id", "region_code", "device",
    "granularity", "period_start"
  );

CREATE FUNCTION guard_user_removed_rank_data_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'user-removed rank and seasonality evidence is append-only'
    USING ERRCODE = '55000';
END
$function$;

CREATE TRIGGER "rank_dimension_history_deletions_no_delete"
BEFORE DELETE ON "rank_dimension_history_deletions"
FOR EACH ROW EXECUTE FUNCTION guard_user_removed_rank_data_mutation();
CREATE TRIGGER "rank_dimension_history_deletions_guarded_update"
BEFORE UPDATE ON "rank_dimension_history_deletions"
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION guard_user_removed_rank_data_mutation();
CREATE TRIGGER "frequency_seasonality_points_no_delete"
BEFORE DELETE ON "frequency_seasonality_points"
FOR EACH ROW EXECUTE FUNCTION guard_user_removed_rank_data_mutation();
CREATE TRIGGER "frequency_seasonality_points_guarded_update"
BEFORE UPDATE ON "frequency_seasonality_points"
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION guard_user_removed_rank_data_mutation();

CREATE OR REPLACE FUNCTION transfer_seo_project_workspace(
  source_workspace_id UUID,
  destination_workspace_id UUID,
  transferred_project_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  relation_name TEXT;
  has_foreign_tenant BOOLEAN;
  changed_rows BIGINT;
  affected_rows BIGINT := 0;
  transferable_relations CONSTANT TEXT[] := ARRAY[
    'ai_answer_snapshots',
    'clustering_proposals',
    'clusters',
    'crawl_duplicate_analyses',
    'crawl_duplicate_group_members',
    'crawl_duplicate_groups',
    'crawl_issues',
    'crawl_membership_analyses',
    'crawl_page_absences',
    'crawl_page_changes',
    'crawl_page_snapshots',
    'current_ranks',
    'frequency_seasonality_points',
    'frequency_snapshots',
    'keyword_groups',
    'keywords',
    'page_aliases',
    'page_create_receipts',
    'page_sources',
    'pages',
    'project_notes',
    'rank_check_finalization_receipts',
    'rank_chunk_ingest_receipts',
    'rank_execution_manifest_chunks',
    'rank_execution_manifest_entries',
    'rank_execution_manifests',
    'rank_dimension_history_deletions',
    'rank_snapshots',
    'semantic_custom_columns',
    'semantic_entity_changes',
    'semantic_group_color_legends',
    'semantic_import_receipts',
    'semantic_keyword_custom_values',
    'semantic_negative_keyword_presets',
    'semantic_saved_views',
    'semantic_undo_receipts',
    'semantic_versions',
    'tags',
    'tracking_context_create_receipts',
    'tracking_context_keyword_assignments',
    'tracking_context_keyword_replace_receipts',
    'tracking_context_versions',
    'tracking_contexts'
  ];
BEGIN
  IF source_workspace_id = destination_workspace_id THEN
    RAISE EXCEPTION 'source and destination workspace must differ';
  END IF;

  FOREACH relation_name IN ARRAY transferable_relations
  LOOP
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1 FROM public.%I
         WHERE project_id = $1
           AND workspace_id <> ALL ($2)
       )',
      relation_name
    )
    INTO has_foreign_tenant
    USING transferred_project_id,
      ARRAY[source_workspace_id, destination_workspace_id]::UUID[];

    IF has_foreign_tenant THEN
      RAISE EXCEPTION 'project data belongs to an unexpected workspace';
    END IF;
  END LOOP;

  PERFORM set_config(
    'seo_platform.project_transfer_source_workspace',
    source_workspace_id::TEXT,
    TRUE
  );
  PERFORM set_config(
    'seo_platform.project_transfer_destination_workspace',
    destination_workspace_id::TEXT,
    TRUE
  );
  PERFORM set_config(
    'seo_platform.project_transfer_project',
    transferred_project_id::TEXT,
    TRUE
  );

  SET CONSTRAINTS ALL DEFERRED;

  FOREACH relation_name IN ARRAY transferable_relations
  LOOP
    EXECUTE format(
      'UPDATE public.%I
       SET workspace_id = $1
       WHERE workspace_id = $2
         AND project_id = $3',
      relation_name
    )
    USING destination_workspace_id, source_workspace_id, transferred_project_id;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    affected_rows := affected_rows + changed_rows;
  END LOOP;

  RETURN affected_rows;
END
$function$;

REVOKE ALL ON FUNCTION transfer_seo_project_workspace(UUID, UUID, UUID)
  FROM PUBLIC;


COMMIT;
