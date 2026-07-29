-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('OPEN', 'RESOLVED', 'DELETED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "collaboration_documents" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" UUID NOT NULL,
    "state_vector" BYTEA,
    "snapshot_object_key" TEXT,
    "version" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "collaboration_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "target_type" VARCHAR(64) NOT NULL,
    "target_id" UUID NOT NULL,
    "parent_id" UUID,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "anchor" JSONB,
    "status" "CommentStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "dedupe_key" VARCHAR(180),
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_events" (
    "event_id" UUID NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "consumer" VARCHAR(100) NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_type" VARCHAR(160) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
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
CREATE INDEX "collaboration_documents_workspace_id_project_id_active_idx" ON "collaboration_documents"("workspace_id", "project_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "collaboration_documents_workspace_id_resource_type_resource_key" ON "collaboration_documents"("workspace_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "comments_workspace_id_project_id_target_type_target_id_stat_idx" ON "comments"("workspace_id", "project_id", "target_type", "target_id", "status");

-- CreateIndex
CREATE INDEX "comments_parent_id_idx" ON "comments"("parent_id");

-- CreateIndex
CREATE INDEX "notifications_workspace_id_user_id_read_at_created_at_idx" ON "notifications"("workspace_id", "user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "inbox_events_consumer_processed_at_idx" ON "inbox_events"("consumer", "processed_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");
