BEGIN;

CREATE TABLE "project_position_history_revisions" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "revision" BIGINT NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_position_history_revisions_pkey"
    PRIMARY KEY ("workspace_id", "project_id"),
  CONSTRAINT "project_position_history_revisions_positive"
    CHECK ("revision" BETWEEN 1 AND 9223372036854775807)
);

CREATE TABLE "project_position_history_projections" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "scope_hash" CHAR(64) NOT NULL,
  "schema_version" VARCHAR(64) NOT NULL,
  "source_revision" BIGINT NOT NULL,
  "payload" JSONB NOT NULL,
  "built_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_position_history_projections_pkey"
    PRIMARY KEY ("workspace_id", "project_id", "scope_hash"),
  CONSTRAINT "project_position_history_projections_scope_hash"
    CHECK ("scope_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "project_position_history_projections_schema_version"
    CHECK ("schema_version" ~ '^[a-z0-9][a-z0-9@._-]{0,63}$'),
  CONSTRAINT "project_position_history_projections_revision"
    CHECK ("source_revision" BETWEEN 1 AND 9223372036854775807),
  CONSTRAINT "project_position_history_projections_payload"
    CHECK (jsonb_typeof("payload") = 'object')
);

INSERT INTO "project_position_history_revisions" (
  "workspace_id",
  "project_id",
  "revision"
)
SELECT DISTINCT source."workspace_id", source."project_id", 1
FROM (
  SELECT "workspace_id", "project_id" FROM "keywords"
  UNION
  SELECT "workspace_id", "project_id" FROM "rank_snapshots"
) source
ON CONFLICT ("workspace_id", "project_id") DO NOTHING;

CREATE FUNCTION bump_project_position_history_revision_from_new_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_position_history_revisions (
    workspace_id,
    project_id,
    revision,
    updated_at
  )
  SELECT DISTINCT workspace_id, project_id, 1, clock_timestamp()
  FROM new_rows
  ON CONFLICT (workspace_id, project_id) DO UPDATE
  SET revision = public.project_position_history_revisions.revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END
$function$;

CREATE FUNCTION bump_project_position_history_revision_from_old_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_position_history_revisions (
    workspace_id,
    project_id,
    revision,
    updated_at
  )
  SELECT DISTINCT workspace_id, project_id, 1, clock_timestamp()
  FROM old_rows
  ON CONFLICT (workspace_id, project_id) DO UPDATE
  SET revision = public.project_position_history_revisions.revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END
$function$;

CREATE FUNCTION bump_project_position_history_revision_from_keyword_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_position_history_revisions (
    workspace_id,
    project_id,
    revision,
    updated_at
  )
  SELECT DISTINCT next_row.workspace_id, next_row.project_id, 1, clock_timestamp()
  FROM new_rows next_row
  INNER JOIN old_rows previous_row ON previous_row.id = next_row.id
  WHERE next_row.status IS DISTINCT FROM previous_row.status
     OR next_row.is_tracked IS DISTINCT FROM previous_row.is_tracked
  ON CONFLICT (workspace_id, project_id) DO UPDATE
  SET revision = public.project_position_history_revisions.revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END
$function$;

CREATE FUNCTION bump_project_position_history_revision_from_context_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_position_history_revisions (
    workspace_id,
    project_id,
    revision,
    updated_at
  )
  SELECT DISTINCT next_row.workspace_id, next_row.project_id, 1, clock_timestamp()
  FROM new_rows next_row
  INNER JOIN old_rows previous_row ON previous_row.id = next_row.id
  WHERE next_row.status IS DISTINCT FROM previous_row.status
  ON CONFLICT (workspace_id, project_id) DO UPDATE
  SET revision = public.project_position_history_revisions.revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END
$function$;

CREATE FUNCTION bump_project_position_history_revision_from_merge_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.project_position_history_revisions (
    workspace_id,
    project_id,
    revision,
    updated_at
  )
  SELECT DISTINCT next_row.workspace_id, next_row.project_id, 1, clock_timestamp()
  FROM new_rows next_row
  INNER JOIN old_rows previous_row ON previous_row.id = next_row.id
  WHERE next_row.source_keyword_id IS DISTINCT FROM previous_row.source_keyword_id
     OR next_row.target_keyword_id IS DISTINCT FROM previous_row.target_keyword_id
  ON CONFLICT (workspace_id, project_id) DO UPDATE
  SET revision = public.project_position_history_revisions.revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END
$function$;

CREATE TRIGGER "rank_snapshots_position_history_revision_insert"
AFTER INSERT ON "rank_snapshots"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION bump_project_position_history_revision_from_new_rows();

CREATE TRIGGER "rank_dimension_history_deletions_position_history_revision_insert"
AFTER INSERT ON "rank_dimension_history_deletions"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION bump_project_position_history_revision_from_new_rows();

CREATE TRIGGER "rank_dimension_merges_position_history_revision_insert"
AFTER INSERT ON "rank_dimension_merges"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION bump_project_position_history_revision_from_new_rows();

CREATE TRIGGER "rank_dimension_merges_position_history_revision_delete"
AFTER DELETE ON "rank_dimension_merges"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION bump_project_position_history_revision_from_old_rows();

CREATE TRIGGER "keyword_merges_position_history_revision_insert"
AFTER INSERT ON "keyword_merges"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION bump_project_position_history_revision_from_new_rows();

CREATE TRIGGER "keyword_merges_position_history_revision_delete"
AFTER DELETE ON "keyword_merges"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION bump_project_position_history_revision_from_old_rows();

CREATE TRIGGER "keyword_merges_position_history_revision_update"
AFTER UPDATE ON "keyword_merges"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION bump_project_position_history_revision_from_merge_updates();

CREATE TRIGGER "keywords_position_history_revision_update"
AFTER UPDATE ON "keywords"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION bump_project_position_history_revision_from_keyword_updates();

CREATE TRIGGER "tracking_contexts_position_history_revision_update"
AFTER UPDATE ON "tracking_contexts"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION bump_project_position_history_revision_from_context_updates();

REVOKE ALL ON FUNCTION bump_project_position_history_revision_from_new_rows()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_project_position_history_revision_from_old_rows()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_project_position_history_revision_from_keyword_updates()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_project_position_history_revision_from_context_updates()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION bump_project_position_history_revision_from_merge_updates()
  FROM PUBLIC;

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
    'keyword_merges',
    'keywords',
    'page_aliases',
    'page_create_receipts',
    'page_sources',
    'pages',
    'project_notes',
    'project_position_history_projections',
    'project_position_history_revisions',
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
