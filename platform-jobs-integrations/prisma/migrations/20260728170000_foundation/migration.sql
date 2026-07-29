-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'ESTIMATING', 'AWAITING_APPROVAL', 'RESERVING_BALANCE', 'QUEUED', 'WAITING_RATE_LIMIT', 'RUNNING', 'PAUSE_REQUESTED', 'PAUSED', 'CANCEL_REQUESTED', 'CANCELLED', 'RETRY_SCHEDULED', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JobItemStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CredentialMode" AS ENUM ('BYOK_API_KEY', 'BYOK_OAUTH', 'PLATFORM_INCLUDED', 'PLATFORM_PAID', 'FALLBACK_PLATFORM_PAID');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'RATE_LIMITED', 'LOW_BALANCE', 'EXPIRED', 'REVOKED', 'INVALID', 'DISABLED');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('INITIATED', 'UPLOADING', 'UPLOADED', 'SCANNING', 'READY', 'REJECTED', 'EXPIRED', 'ABORTED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "type" VARCHAR(100) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "stage" VARCHAR(64),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "actor_id" UUID,
    "schedule_id" UUID,
    "parent_job_id" UUID,
    "deduplication_key" VARCHAR(180),
    "idempotency_key" VARCHAR(180),
    "input_snapshot" JSONB NOT NULL,
    "scope_snapshot" JSONB NOT NULL,
    "progress_current" BIGINT NOT NULL DEFAULT 0,
    "progress_total" BIGINT,
    "progress_unit" VARCHAR(32),
    "estimated_cost_micro" BIGINT,
    "reserved_cost_micro" BIGINT,
    "actual_cost_micro" BIGINT,
    "currency" CHAR(3),
    "credential_mode" "CredentialMode" NOT NULL,
    "provider" VARCHAR(64),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error_summary" JSONB,
    "result_summary" JSONB,
    "correlation_id" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queued_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "cancel_requested_at" TIMESTAMPTZ(6),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "job_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "JobItemStatus" NOT NULL DEFAULT 'PENDING',
    "input_reference" JSONB NOT NULL,
    "provider_request_id" VARCHAR(255),
    "output_reference" JSONB,
    "actual_cost_micro" BIGINT,
    "error" JSONB,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "retry_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "mode" "CredentialMode" NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "ciphertext" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "display_hint" VARCHAR(100),
    "capabilities" JSONB NOT NULL,
    "provider_meta" JSONB,
    "verified_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "last_error_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_bindings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "capability" VARCHAR(100) NOT NULL,
    "primary_credential_id" UUID,
    "fallback_policy" JSONB,
    "budget_policy" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_usage" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "job_id" UUID NOT NULL,
    "job_item_id" UUID,
    "provider" VARCHAR(64) NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "credential_mode" "CredentialMode" NOT NULL,
    "units" BIGINT NOT NULL,
    "provider_cost_micro" BIGINT,
    "customer_price_micro" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "price_book_version" INTEGER,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "definition" JSONB NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "paused_reason" TEXT,
    "next_run_at" TIMESTAMPTZ(6),
    "last_run_at" TIMESTAMPTZ(6),
    "consecutive_errors" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,
    "actor_id" UUID NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'INITIATED',
    "bucket" VARCHAR(100) NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "media_type" VARCHAR(255) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(128) NOT NULL,
    "multipart_id" TEXT,
    "scan_result" JSONB,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "jobs_workspace_id_project_id_status_created_at_idx" ON "jobs"("workspace_id", "project_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "jobs_status_priority_created_at_idx" ON "jobs"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "jobs_deduplication_key_status_idx" ON "jobs"("deduplication_key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_workspace_id_idempotency_key_key" ON "jobs"("workspace_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "job_items_workspace_id_status_retry_at_idx" ON "job_items"("workspace_id", "status", "retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_items_job_id_sequence_key" ON "job_items"("job_id", "sequence");

-- CreateIndex
CREATE INDEX "integration_credentials_workspace_id_provider_status_idx" ON "integration_credentials"("workspace_id", "provider", "status");

-- CreateIndex
CREATE INDEX "integration_bindings_workspace_id_project_id_capability_idx" ON "integration_bindings"("workspace_id", "project_id", "capability");

-- CreateIndex
CREATE INDEX "provider_usage_workspace_id_occurred_at_idx" ON "provider_usage"("workspace_id", "occurred_at");

-- CreateIndex
CREATE INDEX "provider_usage_provider_operation_occurred_at_idx" ON "provider_usage"("provider", "operation", "occurred_at");

-- CreateIndex
CREATE INDEX "provider_usage_job_id_idx" ON "provider_usage"("job_id");

-- CreateIndex
CREATE INDEX "automations_workspace_id_project_id_enabled_next_run_at_idx" ON "automations"("workspace_id", "project_id", "enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "uploads_workspace_id_project_id_status_created_at_idx" ON "uploads"("workspace_id", "project_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "uploads_status_expires_at_idx" ON "uploads"("status", "expires_at");

-- CreateIndex
CREATE INDEX "inbox_events_consumer_processed_at_idx" ON "inbox_events"("consumer", "processed_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- AddForeignKey
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
