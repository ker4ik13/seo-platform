-- Preserve the tenant identity included in the immutable rank-manifest hash.
-- The operational tenant may change during an accepted project transfer, but
-- integrity verification must continue to use the tenant that sealed the row.
ALTER TABLE "rank_execution_manifests"
  ADD COLUMN "integrity_workspace_id" UUID
  GENERATED ALWAYS AS ("workspace_id") STORED;

ALTER TABLE "rank_execution_manifests"
  ALTER COLUMN "integrity_workspace_id" DROP EXPRESSION,
  ALTER COLUMN "integrity_workspace_id" SET NOT NULL;

CREATE FUNCTION set_rank_manifest_integrity_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."integrity_workspace_id" IS NULL THEN
    NEW."integrity_workspace_id" := NEW."workspace_id";
  ELSIF NEW."integrity_workspace_id" <> NEW."workspace_id" THEN
    RAISE EXCEPTION 'rank manifest integrity workspace must match its tenant'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER "rank_execution_manifests_integrity_workspace"
BEFORE INSERT ON "rank_execution_manifests"
FOR EACH ROW
EXECUTE FUNCTION set_rank_manifest_integrity_workspace();

-- This predicate is deliberately usable only while the SECURITY DEFINER
-- transfer routine is running. It permits one exact workspace-id re-key and
-- no mutation of immutable payload/provenance fields.
CREATE FUNCTION project_workspace_rekey_allowed(
  old_record JSONB,
  new_record JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  transfer_owner NAME;
  source_workspace TEXT;
  destination_workspace TEXT;
  transferred_project TEXT;
BEGIN
  IF old_record IS NULL OR new_record IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT pg_get_userbyid(procedure.proowner)
  INTO transfer_owner
  FROM pg_proc AS procedure
  WHERE procedure.oid =
    'public.transfer_seo_project_workspace(uuid,uuid,uuid)'::regprocedure;

  source_workspace := current_setting(
    'seo_platform.project_transfer_source_workspace',
    TRUE
  );
  destination_workspace := current_setting(
    'seo_platform.project_transfer_destination_workspace',
    TRUE
  );
  transferred_project := current_setting(
    'seo_platform.project_transfer_project',
    TRUE
  );

  RETURN transfer_owner IS NOT NULL
    AND current_user = transfer_owner
    AND source_workspace IS NOT NULL
    AND destination_workspace IS NOT NULL
    AND transferred_project IS NOT NULL
    AND old_record ->> 'workspace_id' = source_workspace
    AND new_record ->> 'workspace_id' = destination_workspace
    AND old_record ->> 'project_id' = transferred_project
    AND new_record ->> 'project_id' = transferred_project
    AND (old_record - 'workspace_id')
      IS NOT DISTINCT FROM (new_record - 'workspace_id');
END
$function$;

REVOKE ALL ON FUNCTION project_workspace_rekey_allowed(JSONB, JSONB)
  FROM PUBLIC;

-- Keep the ordinary immutable/monotonic guards intact, while exempting only
-- the exact administrative tenant re-key described above.
DROP TRIGGER "rank_execution_manifests_immutable"
  ON "rank_execution_manifests";
CREATE TRIGGER "rank_execution_manifests_immutable"
BEFORE INSERT OR DELETE ON "rank_execution_manifests"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_execution_manifest_mutation"();
CREATE TRIGGER "rank_execution_manifests_rekey_guarded_update"
BEFORE UPDATE ON "rank_execution_manifests"
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "guard_rank_execution_manifest_mutation"();

DROP TRIGGER "rank_execution_manifests_sealed_at_commit"
  ON "rank_execution_manifests";
CREATE CONSTRAINT TRIGGER "rank_execution_manifests_sealed_at_commit"
AFTER INSERT ON "rank_execution_manifests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "require_rank_execution_manifest_sealed_at_commit"();
CREATE CONSTRAINT TRIGGER "rank_execution_manifests_sealed_rekey_guarded_update"
AFTER UPDATE ON "rank_execution_manifests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "require_rank_execution_manifest_sealed_at_commit"();

DROP TRIGGER "rank_execution_manifests_finalized_at_commit"
  ON "rank_execution_manifests";
CREATE CONSTRAINT TRIGGER "rank_execution_manifests_finalized_at_commit"
AFTER UPDATE ON "rank_execution_manifests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "require_rank_execution_manifest_finalization_at_commit"();

DROP TRIGGER "rank_execution_manifest_chunks_immutable"
  ON "rank_execution_manifest_chunks";
CREATE TRIGGER "rank_execution_manifest_chunks_immutable"
BEFORE INSERT OR DELETE ON "rank_execution_manifest_chunks"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_execution_manifest_child_mutation"();
CREATE TRIGGER "rank_execution_manifest_chunks_rekey_guarded_update"
BEFORE UPDATE ON "rank_execution_manifest_chunks"
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "guard_rank_execution_manifest_child_mutation"();

DROP TRIGGER "rank_execution_manifest_entries_immutable"
  ON "rank_execution_manifest_entries";
CREATE TRIGGER "rank_execution_manifest_entries_immutable"
BEFORE INSERT OR DELETE ON "rank_execution_manifest_entries"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_execution_manifest_child_mutation"();
CREATE TRIGGER "rank_execution_manifest_entries_rekey_guarded_update"
BEFORE UPDATE ON "rank_execution_manifest_entries"
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "guard_rank_execution_manifest_child_mutation"();

DROP TRIGGER "rank_check_finalization_receipts_immutable"
  ON "rank_check_finalization_receipts";
CREATE TRIGGER "rank_check_finalization_receipts_immutable"
BEFORE INSERT OR DELETE ON "rank_check_finalization_receipts"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_check_finalization_receipt_mutation"();
CREATE TRIGGER "rank_check_finalization_receipts_rekey_guarded_update"
BEFORE UPDATE ON "rank_check_finalization_receipts"
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "guard_rank_check_finalization_receipt_mutation"();

DROP TRIGGER "rank_chunk_ingest_receipts_immutable"
  ON "rank_chunk_ingest_receipts";
CREATE TRIGGER "rank_chunk_ingest_receipts_immutable"
BEFORE INSERT OR DELETE ON "rank_chunk_ingest_receipts"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_chunk_ingest_receipt_mutation"();
CREATE TRIGGER "rank_chunk_ingest_receipts_rekey_guarded_update"
BEFORE UPDATE ON "rank_chunk_ingest_receipts"
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "guard_rank_chunk_ingest_receipt_mutation"();

DROP TRIGGER "rank_snapshots_immutable" ON "rank_snapshots";
CREATE TRIGGER "rank_snapshots_immutable"
BEFORE INSERT OR DELETE ON "rank_snapshots"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_snapshot_mutation"();
CREATE TRIGGER "rank_snapshots_rekey_guarded_update"
BEFORE UPDATE ON "rank_snapshots"
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "guard_rank_snapshot_mutation"();

DROP TRIGGER "current_ranks_monotonic" ON "current_ranks";
CREATE TRIGGER "current_ranks_monotonic"
BEFORE INSERT OR DELETE ON "current_ranks"
FOR EACH ROW
EXECUTE FUNCTION "guard_current_rank_mutation"();
CREATE TRIGGER "current_ranks_rekey_guarded_update"
BEFORE UPDATE ON "current_ranks"
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "guard_current_rank_mutation"();

DROP TRIGGER "current_ranks_ingest_receipt_at_commit" ON "current_ranks";
CREATE CONSTRAINT TRIGGER "current_ranks_ingest_receipt_at_commit"
AFTER INSERT ON "current_ranks"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "require_current_rank_ingest_receipt_at_commit"();
CREATE CONSTRAINT TRIGGER "current_ranks_receipt_rekey_guarded_update"
AFTER UPDATE ON "current_ranks"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "require_current_rank_ingest_receipt_at_commit"();

DO $migration$
DECLARE
  trigger_record RECORD;
BEGIN
  FOR trigger_record IN
    SELECT *
    FROM (VALUES
      ('crawl_duplicate_analyses', 'crawl_duplicate_analyses_immutable_trigger'),
      ('crawl_duplicate_group_members', 'crawl_duplicate_group_members_immutable_trigger'),
      ('crawl_duplicate_groups', 'crawl_duplicate_groups_immutable_trigger'),
      ('crawl_membership_analyses', 'crawl_membership_analyses_immutable_trigger'),
      ('crawl_page_absences', 'crawl_page_absences_immutable_trigger'),
      ('crawl_page_changes', 'crawl_page_changes_immutable_trigger'),
      ('crawl_page_snapshots', 'crawl_page_snapshots_immutable_trigger')
    ) AS triggers(table_name, trigger_name)
  LOOP
    EXECUTE format(
      'DROP TRIGGER %I ON public.%I',
      trigger_record.trigger_name,
      trigger_record.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON public.%I '
        || 'FOR EACH ROW '
        || 'EXECUTE FUNCTION public.reject_crawl_snapshot_mutation()',
      trigger_record.trigger_name,
      trigger_record.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I '
        || 'FOR EACH ROW WHEN (NOT public.project_workspace_rekey_allowed('
        || 'to_jsonb(OLD), to_jsonb(NEW))) '
        || 'EXECUTE FUNCTION public.reject_crawl_snapshot_mutation()',
      trigger_record.trigger_name || '_rekey_guarded_update',
      trigger_record.table_name
    );
  END LOOP;
END
$migration$;

-- Replace schema discovery with an explicit domain allowlist. New project
-- tables must therefore be reviewed before becoming part of a transfer.
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
