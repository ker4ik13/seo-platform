-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "DataSourceMode" AS ENUM ('BYOK', 'PLATFORM', 'IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "keywords" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "text_original" TEXT NOT NULL,
    "text_normalized" TEXT NOT NULL,
    "normalized_hash" CHAR(64) NOT NULL,
    "language" VARCHAR(16) NOT NULL DEFAULT 'und',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "cluster_id" UUID,
    "target_page_id" UUID,
    "is_tracked" BOOLEAN NOT NULL DEFAULT false,
    "custom_values" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_groups" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "color" VARCHAR(16),
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "keyword_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_group_memberships" (
    "project_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_group_memberships_pkey" PRIMARY KEY ("keyword_id","group_id")
);

-- CreateTable
CREATE TABLE "clusters" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "method" VARCHAR(64) NOT NULL,
    "evidence" JSONB,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "url_hash" CHAR(64) NOT NULL,
    "title" TEXT,
    "content_status" VARCHAR(64),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_contexts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "search_engine" VARCHAR(32) NOT NULL,
    "region_code" VARCHAR(100) NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "device" VARCHAR(32) NOT NULL,
    "depth" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rank_snapshots" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "tracking_context_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "position" INTEGER,
    "result_url" TEXT,
    "provider" VARCHAR(64) NOT NULL,
    "source_mode" "DataSourceMode" NOT NULL,
    "job_id" UUID NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rank_snapshots_pkey" PRIMARY KEY ("observed_at","id")
);

-- CreateTable
CREATE TABLE "current_ranks" (
    "project_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "tracking_context_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "position" INTEGER,
    "result_url" TEXT,
    "provider" VARCHAR(64) NOT NULL,
    "source_mode" "DataSourceMode" NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "current_ranks_pkey" PRIMARY KEY ("keyword_id","tracking_context_id")
);

-- CreateTable
CREATE TABLE "frequency_snapshots" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "keyword_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "region_code" VARCHAR(100) NOT NULL,
    "value" BIGINT,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "source_mode" "DataSourceMode" NOT NULL,
    "job_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "frequency_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semantic_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "reason" VARCHAR(160) NOT NULL,
    "actor_id" UUID NOT NULL,
    "manifest" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semantic_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_type" VARCHAR(160) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "keywords_workspace_id_project_id_status_id_idx" ON "keywords"("workspace_id", "project_id", "status", "id");

-- CreateIndex
CREATE INDEX "keywords_project_id_cluster_id_id_idx" ON "keywords"("project_id", "cluster_id", "id");

-- CreateIndex
CREATE INDEX "keywords_project_id_target_page_id_id_idx" ON "keywords"("project_id", "target_page_id", "id");

-- CreateIndex
CREATE INDEX "keywords_project_id_is_tracked_id_idx" ON "keywords"("project_id", "is_tracked", "id");

-- CreateIndex
CREATE UNIQUE INDEX "keywords_project_id_language_normalized_hash_key" ON "keywords"("project_id", "language", "normalized_hash");

-- CreateIndex
CREATE INDEX "keyword_groups_project_id_parent_id_position_idx" ON "keyword_groups"("project_id", "parent_id", "position");

-- CreateIndex
CREATE INDEX "keyword_group_memberships_project_id_group_id_keyword_id_idx" ON "keyword_group_memberships"("project_id", "group_id", "keyword_id");

-- CreateIndex
CREATE INDEX "clusters_project_id_status_id_idx" ON "clusters"("project_id", "status", "id");

-- CreateIndex
CREATE INDEX "pages_workspace_id_project_id_status_id_idx" ON "pages"("workspace_id", "project_id", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pages_project_id_url_hash_key" ON "pages"("project_id", "url_hash");

-- CreateIndex
CREATE INDEX "tracking_contexts_project_id_status_id_idx" ON "tracking_contexts"("project_id", "status", "id");

-- CreateIndex
CREATE INDEX "rank_snapshots_project_id_tracking_context_id_observed_at_idx" ON "rank_snapshots"("project_id", "tracking_context_id", "observed_at");

-- CreateIndex
CREATE INDEX "rank_snapshots_project_id_keyword_id_tracking_context_id_ob_idx" ON "rank_snapshots"("project_id", "keyword_id", "tracking_context_id", "observed_at");

-- CreateIndex
CREATE INDEX "current_ranks_project_id_tracking_context_id_position_idx" ON "current_ranks"("project_id", "tracking_context_id", "position");

-- CreateIndex
CREATE INDEX "frequency_snapshots_project_id_keyword_id_type_region_code__idx" ON "frequency_snapshots"("project_id", "keyword_id", "type", "region_code", "observed_at");

-- CreateIndex
CREATE INDEX "semantic_versions_workspace_id_project_id_created_at_idx" ON "semantic_versions"("workspace_id", "project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "semantic_versions_project_id_number_key" ON "semantic_versions"("project_id", "number");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- AddForeignKey
ALTER TABLE "keyword_group_memberships" ADD CONSTRAINT "keyword_group_memberships_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_group_memberships" ADD CONSTRAINT "keyword_group_memberships_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "keyword_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
