BEGIN;

ALTER TABLE "automations"
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID,
  ADD COLUMN "idempotency_key" VARCHAR(180);

CREATE UNIQUE INDEX "automations_workspace_actor_idempotency_key"
  ON "automations" ("workspace_id", "created_by", "idempotency_key");
CREATE UNIQUE INDEX "automations_tenant_project_id_key"
  ON "automations" ("id", "workspace_id", "project_id");

ALTER TABLE "automations"
  ADD CONSTRAINT "automations_provenance_check" CHECK (
    ("created_by" IS NULL AND "idempotency_key" IS NULL)
    OR
    ("created_by" IS NOT NULL AND "idempotency_key" IS NOT NULL)
  ),
  ADD CONSTRAINT "automations_lifecycle_check" CHECK (
    "version" >= 1
    AND "consecutive_errors" >= 0
    AND (
      "paused_reason" IS NULL
      OR "paused_reason" IN ('MANUAL', 'FAILURE_THRESHOLD')
    )
    AND (NOT "enabled" OR "paused_reason" IS NULL)
  );

CREATE TYPE "AutomationRunStatus" AS ENUM (
  'RUNNING',
  'DISPATCHED',
  'SKIPPED',
  'COMPLETED',
  'FAILED'
);

CREATE TYPE "AutomationRunTrigger" AS ENUM ('SCHEDULE', 'MANUAL');

CREATE TABLE "automation_runs" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "automation_id" UUID NOT NULL,
  "automation_version" INTEGER NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "status" "AutomationRunStatus" NOT NULL,
  "trigger" "AutomationRunTrigger" NOT NULL,
  "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
  "actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(180),
  "definition" JSONB NOT NULL,
  "estimate_id" UUID,
  "job_id" UUID,
  "error_code" VARCHAR(100),
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_runs_automation_tenant_fkey"
    FOREIGN KEY ("automation_id", "workspace_id", "project_id")
    REFERENCES "automations"("id", "workspace_id", "project_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "automation_runs_estimate_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "estimate_id")
    REFERENCES "rank_estimates"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "automation_runs_job_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES "jobs"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "automation_runs_lifecycle_check" CHECK (
    (
      "status" = 'RUNNING'
      AND "started_at" IS NOT NULL
      AND "estimate_id" IS NULL
      AND "finished_at" IS NULL
      AND "job_id" IS NULL
      AND "error_code" IS NULL
    )
    OR (
      "status" = 'DISPATCHED'
      AND "started_at" IS NOT NULL
      AND "finished_at" IS NULL
      AND "estimate_id" IS NOT NULL
      AND "job_id" IS NOT NULL
      AND "error_code" IS NULL
    )
    OR (
      "status" = 'SKIPPED'
      AND "started_at" IS NULL
      AND "estimate_id" IS NULL
      AND "job_id" IS NULL
      AND "finished_at" IS NOT NULL
      AND "error_code" IS NOT NULL
    )
    OR (
      "status" = 'FAILED'
      AND "started_at" IS NOT NULL
      AND "finished_at" IS NOT NULL
      AND "error_code" IS NOT NULL
    )
    OR (
      "status" = 'COMPLETED'
      AND "started_at" IS NOT NULL
      AND "finished_at" IS NOT NULL
      AND "estimate_id" IS NOT NULL
      AND "job_id" IS NOT NULL
      AND "error_code" IS NULL
    )
  ),
  CONSTRAINT "automation_runs_values_check" CHECK (
    "automation_version" >= 1
    AND (
      "error_code" IS NULL
      OR "error_code" ~ '^[A-Z][A-Z0-9_]{0,99}$'
    )
    AND (
      "started_at" IS NULL
      OR "started_at" >= "created_at"
    )
    AND (
      "finished_at" IS NULL
      OR "finished_at" >= COALESCE("started_at", "created_at")
    )
  ),
  CONSTRAINT "automation_runs_trigger_idempotency_check" CHECK (
    (
      "trigger" = 'SCHEDULE'
      AND "idempotency_key" IS NULL
    )
    OR (
      "trigger" = 'MANUAL'
      AND "idempotency_key" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "automation_runs_schedule_key"
  ON "automation_runs" ("automation_id", "scheduled_for");
CREATE UNIQUE INDEX "automation_runs_manual_idempotency_key"
  ON "automation_runs" ("automation_id", "actor_id", "idempotency_key");
CREATE INDEX "automation_runs_tenant_created_idx"
  ON "automation_runs" (
    "workspace_id",
    "project_id",
    "automation_id",
    "created_at"
  );
CREATE INDEX "automation_runs_status_created_idx"
  ON "automation_runs" ("status", "created_at");

COMMIT;
