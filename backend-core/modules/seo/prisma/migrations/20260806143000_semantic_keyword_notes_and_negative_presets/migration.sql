ALTER TABLE "keywords"
  ADD COLUMN "note" TEXT;

ALTER TABLE "keywords"
  ADD CONSTRAINT "keywords_note_length"
  CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 4000);

CREATE TABLE "semantic_negative_keyword_presets" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "normalized_name" VARCHAR(160) NOT NULL,
  "words" TEXT[] NOT NULL,
  "match_mode" VARCHAR(32) NOT NULL,
  "case_sensitive" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "semantic_negative_keyword_presets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "semantic_negative_keyword_presets_tenant_project_id_key"
    UNIQUE ("workspace_id", "project_id", "id"),
  CONSTRAINT "semantic_negative_keyword_presets_name_length"
    CHECK (char_length("name") BETWEEN 1 AND 160),
  CONSTRAINT "semantic_negative_keyword_presets_words_count"
    CHECK (cardinality("words") BETWEEN 1 AND 500),
  CONSTRAINT "semantic_negative_keyword_presets_words_valid"
    CHECK (array_position("words", NULL) IS NULL),
  CONSTRAINT "semantic_negative_keyword_presets_match_mode"
    CHECK ("match_mode" IN ('CONTAINS', 'WHOLE_WORD')),
  CONSTRAINT "semantic_negative_keyword_presets_delete_consistent"
    CHECK (
      ("status" = 'ACTIVE' AND "deleted_at" IS NULL)
      OR ("status" = 'DELETED' AND "deleted_at" IS NOT NULL)
    )
);

CREATE INDEX "semantic_negative_keyword_presets_project_name_idx"
  ON "semantic_negative_keyword_presets"
  ("workspace_id", "project_id", "status", "normalized_name", "id");

CREATE UNIQUE INDEX "semantic_negative_keyword_presets_active_name_key"
  ON "semantic_negative_keyword_presets"
  ("workspace_id", "project_id", "normalized_name")
  WHERE "status" = 'ACTIVE';

-- Project transfer is deliberately allowlisted. Register the new project-owned
-- relation in the same SECURITY DEFINER routine so presets cannot remain in the
-- previous owner's workspace after an accepted transfer.
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
    'frequency_snapshots',
    'keyword_groups',
    'keywords',
    'page_aliases',
    'page_create_receipts',
    'page_sources',
    'pages',
    'rank_check_finalization_receipts',
    'rank_chunk_ingest_receipts',
    'rank_execution_manifest_chunks',
    'rank_execution_manifest_entries',
    'rank_execution_manifests',
    'rank_snapshots',
    'semantic_custom_columns',
    'semantic_entity_changes',
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
