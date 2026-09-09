BEGIN;

CREATE TABLE "rank_dimension_merges" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "source_dimension_key" VARCHAR(1000) NOT NULL,
  "source_region_label" VARCHAR(160),
  "target_dimension_key" VARCHAR(1000) NOT NULL,
  "target_region_label" VARCHAR(160),
  "created_by" UUID NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rank_dimension_merges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rank_dimension_merges_distinct_keys_check"
    CHECK ("source_dimension_key" <> "target_dimension_key"),
  CONSTRAINT "rank_dimension_merges_request_hash_check"
    CHECK (octet_length("request_hash") = 32),
  CONSTRAINT "rank_dimension_merges_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "rank_dimension_merges_idempotency_key"
  ON "rank_dimension_merges" ("workspace_id", "idempotency_key");
CREATE UNIQUE INDEX "rank_dimension_merges_source_key"
  ON "rank_dimension_merges" (
    "workspace_id", "project_id", "source_dimension_key"
  );
CREATE UNIQUE INDEX "rank_dimension_merges_tenant_project_id_key"
  ON "rank_dimension_merges" ("workspace_id", "project_id", "id");
CREATE INDEX "rank_dimension_merges_target_idx"
  ON "rank_dimension_merges" (
    "workspace_id", "project_id", "target_dimension_key"
  );

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
    'rank_dimension_merges',
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
