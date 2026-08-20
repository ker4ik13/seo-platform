BEGIN;

CREATE TYPE "ClusteringProposalStatus" AS ENUM ('READY', 'APPLIED', 'REJECTED');

CREATE TABLE "clustering_proposals" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "connector_version" VARCHAR(100) NOT NULL,
  "parameters" JSONB NOT NULL,
  "status" "ClusteringProposalStatus" NOT NULL DEFAULT 'READY',
  "keyword_count" INTEGER NOT NULL,
  "cluster_count" INTEGER NOT NULL,
  "unclustered_count" INTEGER NOT NULL,
  "applied_keyword_count" INTEGER NOT NULL DEFAULT 0,
  "created_group_count" INTEGER NOT NULL DEFAULT 0,
  "semantic_version_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "applied_by" UUID,
  "rejected_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "applied_at" TIMESTAMPTZ(6),
  "rejected_at" TIMESTAMPTZ(6),
  CONSTRAINT "clustering_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clustering_proposals_provider_check" CHECK ("provider" = 'ARSENKIN'),
  CONSTRAINT "clustering_proposals_counts_check" CHECK (
    "keyword_count" BETWEEN 1 AND 10000 AND
    "cluster_count" BETWEEN 0 AND "keyword_count" AND
    "unclustered_count" BETWEEN 0 AND "keyword_count" AND
    "applied_keyword_count" BETWEEN 0 AND "keyword_count" AND
    "created_group_count" BETWEEN 0 AND "cluster_count" + 1
  ),
  CONSTRAINT "clustering_proposals_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "clustering_proposals_job_id_key"
  ON "clustering_proposals"("job_id");
CREATE UNIQUE INDEX "clustering_proposals_tenant_project_id_key"
  ON "clustering_proposals"("workspace_id", "project_id", "id");
CREATE INDEX "clustering_proposals_project_status_created_idx"
  ON "clustering_proposals"("workspace_id", "project_id", "status", "created_at" DESC, "id" DESC);

CREATE TABLE "clustering_proposal_clusters" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "proposal_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "provider_key" VARCHAR(255) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "top_url" TEXT,
  "frequency_sum" BIGINT,
  "main_page_count" INTEGER,
  "keyword_count" INTEGER NOT NULL,
  "applied_cluster_id" UUID,
  "applied_group_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clustering_proposal_clusters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clustering_proposal_clusters_proposal_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "clustering_proposals"("id")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "clustering_proposal_clusters_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "clustering_proposal_clusters_keyword_count_check" CHECK ("keyword_count" >= 1),
  CONSTRAINT "clustering_proposal_clusters_frequency_check" CHECK ("frequency_sum" IS NULL OR "frequency_sum" >= 0),
  CONSTRAINT "clustering_proposal_clusters_main_page_check" CHECK ("main_page_count" IS NULL OR "main_page_count" >= 0),
  CONSTRAINT "clustering_proposal_clusters_top_url_check" CHECK ("top_url" IS NULL OR char_length("top_url") <= 8192)
);

CREATE UNIQUE INDEX "clustering_proposal_clusters_sequence_key"
  ON "clustering_proposal_clusters"("proposal_id", "sequence");
CREATE UNIQUE INDEX "clustering_proposal_clusters_provider_key"
  ON "clustering_proposal_clusters"("proposal_id", "provider_key");
CREATE UNIQUE INDEX "clustering_proposal_clusters_proposal_id_id_key"
  ON "clustering_proposal_clusters"("proposal_id", "id");
CREATE INDEX "clustering_proposal_clusters_proposal_idx"
  ON "clustering_proposal_clusters"("proposal_id", "id");

CREATE TABLE "clustering_proposal_items" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "proposal_id" UUID NOT NULL,
  "proposal_cluster_id" UUID,
  "sequence" INTEGER NOT NULL,
  "keyword_id" UUID NOT NULL,
  "keyword_version" INTEGER NOT NULL,
  "keyword_text" TEXT NOT NULL,
  "frequency" BIGINT,
  "exact_frequency" BIGINT,
  "aggregators_percent" DOUBLE PRECISION,
  "toponym" VARCHAR(255),
  "geo_dependent" BOOLEAN,
  "applied_cluster_id" UUID,
  "applied_group_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clustering_proposal_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clustering_proposal_items_proposal_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "clustering_proposals"("id")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "clustering_proposal_items_cluster_fkey"
    FOREIGN KEY ("proposal_cluster_id") REFERENCES "clustering_proposal_clusters"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "clustering_proposal_items_scoped_cluster_fkey"
    FOREIGN KEY ("proposal_id", "proposal_cluster_id")
    REFERENCES "clustering_proposal_clusters"("proposal_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "clustering_proposal_items_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "clustering_proposal_items_keyword_version_check" CHECK ("keyword_version" >= 1),
  CONSTRAINT "clustering_proposal_items_frequency_check" CHECK ("frequency" IS NULL OR "frequency" >= 0),
  CONSTRAINT "clustering_proposal_items_exact_frequency_check" CHECK ("exact_frequency" IS NULL OR "exact_frequency" >= 0),
  CONSTRAINT "clustering_proposal_items_aggregators_check" CHECK ("aggregators_percent" IS NULL OR "aggregators_percent" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "clustering_proposal_items_sequence_key"
  ON "clustering_proposal_items"("proposal_id", "sequence");
CREATE UNIQUE INDEX "clustering_proposal_items_keyword_key"
  ON "clustering_proposal_items"("proposal_id", "keyword_id");
CREATE INDEX "clustering_proposal_items_cluster_sequence_idx"
  ON "clustering_proposal_items"("proposal_id", "proposal_cluster_id", "sequence");

-- Project transfer is allowlisted. Register proposal rows so the operation
-- receipt always moves with the semantic core that owns it.
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
