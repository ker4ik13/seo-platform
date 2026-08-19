BEGIN;

CREATE TABLE "ai_answer_snapshots" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "keyword_id" UUID NOT NULL,
  "search_engine" VARCHAR(16) NOT NULL,
  "region_code" VARCHAR(100) NOT NULL,
  "device" VARCHAR(16) NOT NULL,
  "host" VARCHAR(255) NOT NULL,
  "answer_present" BOOLEAN NOT NULL,
  "site_found" BOOLEAN NOT NULL,
  "position" INTEGER,
  "ranking_url" TEXT,
  "brand_found" BOOLEAN NOT NULL,
  "answer_markdown" TEXT,
  "provider" VARCHAR(32) NOT NULL,
  "source_mode" "DataSourceMode" NOT NULL,
  "job_id" UUID NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_answer_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_answer_snapshots_search_engine_check"
    CHECK ("search_engine" IN ('YANDEX', 'GOOGLE')),
  CONSTRAINT "ai_answer_snapshots_device_check"
    CHECK ("device" IN ('DESKTOP', 'MOBILE')),
  CONSTRAINT "ai_answer_snapshots_provider_check"
    CHECK ("provider" = 'ARSENKIN'),
  CONSTRAINT "ai_answer_snapshots_position_check"
    CHECK ("position" IS NULL OR "position" BETWEEN 1 AND 100000),
  CONSTRAINT "ai_answer_snapshots_answer_check"
    CHECK ("answer_present" OR "answer_markdown" IS NULL),
  CONSTRAINT "ai_answer_snapshots_site_position_check"
    CHECK (
      "site_found" = ("position" IS NOT NULL AND "ranking_url" IS NOT NULL)
    ),
  CONSTRAINT "ai_answer_snapshots_region_code_check"
    CHECK (char_length("region_code") BETWEEN 1 AND 100),
  CONSTRAINT "ai_answer_snapshots_host_check"
    CHECK (char_length("host") BETWEEN 1 AND 253),
  CONSTRAINT "ai_answer_snapshots_ranking_url_check"
    CHECK ("ranking_url" IS NULL OR char_length("ranking_url") <= 8192),
  CONSTRAINT "ai_answer_snapshots_answer_markdown_check"
    CHECK ("answer_markdown" IS NULL OR char_length("answer_markdown") <= 300000),
  CONSTRAINT "ai_answer_snapshots_keyword_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "keyword_id")
    REFERENCES "keywords"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE UNIQUE INDEX "ai_answer_snapshots_job_keyword_engine_key"
  ON "ai_answer_snapshots"("job_id", "keyword_id", "search_engine");
CREATE INDEX "ai_answer_snapshots_keyword_engine_latest_idx"
  ON "ai_answer_snapshots"(
    "workspace_id",
    "project_id",
    "keyword_id",
    "search_engine",
    "observed_at" DESC,
    "id" DESC
  );
CREATE INDEX "ai_answer_snapshots_job_idx"
  ON "ai_answer_snapshots"("workspace_id", "project_id", "job_id");

CREATE TABLE "ai_answer_sources" (
  "snapshot_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "provider_id" INTEGER,
  "url" TEXT NOT NULL,
  "title" TEXT,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_answer_sources_pkey" PRIMARY KEY ("snapshot_id", "position"),
  CONSTRAINT "ai_answer_sources_position_check" CHECK ("position" BETWEEN 1 AND 100),
  CONSTRAINT "ai_answer_sources_provider_id_check"
    CHECK ("provider_id" IS NULL OR "provider_id" BETWEEN 0 AND 100000),
  CONSTRAINT "ai_answer_sources_url_check"
    CHECK (char_length("url") BETWEEN 1 AND 8192),
  CONSTRAINT "ai_answer_sources_title_check"
    CHECK ("title" IS NULL OR char_length("title") <= 4000),
  CONSTRAINT "ai_answer_sources_description_check"
    CHECK ("description" IS NULL OR char_length("description") <= 12000),
  CONSTRAINT "ai_answer_sources_snapshot_fkey"
    FOREIGN KEY ("snapshot_id") REFERENCES "ai_answer_snapshots"("id")
    ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE FUNCTION "reject_ai_answer_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'AI answer snapshots and sources are immutable'
    USING ERRCODE = '55000';
END
$function$;

CREATE TRIGGER "ai_answer_snapshots_immutable_delete"
  BEFORE DELETE ON "ai_answer_snapshots"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_ai_answer_mutation"();

CREATE TRIGGER "ai_answer_snapshots_rekey_guarded_update"
  BEFORE UPDATE ON "ai_answer_snapshots"
  FOR EACH ROW
  WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
  EXECUTE FUNCTION "reject_ai_answer_mutation"();

CREATE TRIGGER "ai_answer_sources_immutable"
  BEFORE UPDATE OR DELETE ON "ai_answer_sources"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_ai_answer_mutation"();

CREATE TRIGGER "ai_answer_snapshots_no_truncate"
  BEFORE TRUNCATE ON "ai_answer_snapshots"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "reject_ai_answer_mutation"();

CREATE TRIGGER "ai_answer_sources_no_truncate"
  BEFORE TRUNCATE ON "ai_answer_sources"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "reject_ai_answer_mutation"();

-- Project transfer is allowlisted. Register AI snapshots (and the project
-- notes relation introduced after the previous function revision) so no
-- project-owned data remains under the former workspace tenant.
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
    'project_notes',
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

COMMIT;
