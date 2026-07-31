CREATE TYPE "TechnicalCrawlStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE "technical_crawls" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "host" VARCHAR(253) NOT NULL,
  "config" JSONB NOT NULL,
  "checkpoint" JSONB,
  "status" "TechnicalCrawlStatus" NOT NULL DEFAULT 'QUEUED',
  "discovered_urls" INTEGER NOT NULL DEFAULT 0,
  "processed_urls" INTEGER NOT NULL DEFAULT 0,
  "successful_urls" INTEGER NOT NULL DEFAULT 0,
  "failed_urls" INTEGER NOT NULL DEFAULT 0,
  "issue_count" INTEGER NOT NULL DEFAULT 0,
  "failure_code" VARCHAR(64),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "cancel_requested_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "technical_crawls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "technical_crawls_counts_check" CHECK (
    "discovered_urls" >= 0 AND
    "processed_urls" >= 0 AND
    "successful_urls" >= 0 AND
    "failed_urls" >= 0 AND
    "issue_count" >= 0 AND
    "processed_urls" = "successful_urls" + "failed_urls"
  ),
  CONSTRAINT "technical_crawls_version_check" CHECK ("version" > 0),
  CONSTRAINT "technical_crawls_checkpoint_check" CHECK (
    "checkpoint" IS NULL OR (
      jsonb_typeof("checkpoint") = 'object' AND
      "checkpoint"->>'version' = '1' AND
      jsonb_typeof("checkpoint"->'pending') = 'array' AND
      jsonb_typeof("checkpoint"->'seen') = 'array' AND
      jsonb_array_length("checkpoint"->'pending') <= 1000 AND
      jsonb_array_length("checkpoint"->'seen') <= 1000
    )
  ),
  CONSTRAINT "technical_crawls_host_check" CHECK (
    length("host") BETWEEN 1 AND 253 AND
    "host" = lower("host") AND
    "host" !~ '[/@]'
  )
);

CREATE UNIQUE INDEX "technical_crawls_job_id_key"
  ON "technical_crawls"("job_id");
CREATE UNIQUE INDEX "technical_crawls_tenant_project_id_key"
  ON "technical_crawls"("workspace_id", "project_id", "id");
CREATE UNIQUE INDEX "technical_crawls_tenant_project_job_key"
  ON "technical_crawls"("workspace_id", "project_id", "job_id");
CREATE INDEX "technical_crawls_project_created_idx"
  ON "technical_crawls"("workspace_id", "project_id", "created_at" DESC);
CREATE INDEX "technical_crawls_status_created_idx"
  ON "technical_crawls"("status", "created_at");
CREATE UNIQUE INDEX "technical_crawls_one_active_host_key"
  ON "technical_crawls"("host")
  WHERE "status" IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED');

ALTER TABLE "technical_crawls"
  ADD CONSTRAINT "technical_crawls_job_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "job_id")
  REFERENCES "jobs"("workspace_id", "project_id", "id")
  ON DELETE CASCADE ON UPDATE RESTRICT;
