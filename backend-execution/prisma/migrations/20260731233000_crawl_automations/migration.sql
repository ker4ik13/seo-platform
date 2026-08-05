BEGIN;

CREATE TABLE "crawl_automations" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "definition" JSONB NOT NULL,
  "timezone" VARCHAR(64) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "paused_reason" VARCHAR(64),
  "next_run_at" TIMESTAMPTZ(6),
  "last_run_at" TIMESTAMPTZ(6),
  "consecutive_errors" INTEGER NOT NULL DEFAULT 0,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "crawl_automations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crawl_automations_values_check" CHECK (
    length(btrim("name")) BETWEEN 1 AND 160
    AND jsonb_typeof("definition") = 'object'
    AND length("timezone") BETWEEN 1 AND 64
    AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$'
    AND "version" >= 1
    AND "consecutive_errors" >= 0
    AND (
      "paused_reason" IS NULL
      OR "paused_reason" IN (
        'MANUAL',
        'FAILURE_THRESHOLD',
        'AUTHORIZATION_REVOKED',
        'READ_ONLY_BILLING'
      )
    )
    AND (NOT "enabled" OR "paused_reason" IS NULL)
  )
);

CREATE UNIQUE INDEX "crawl_automations_workspace_actor_idempotency_key"
  ON "crawl_automations"(
    "workspace_id",
    "created_by",
    "idempotency_key"
  );
CREATE UNIQUE INDEX "crawl_automations_tenant_project_id_key"
  ON "crawl_automations"("id", "workspace_id", "project_id");
CREATE INDEX "crawl_automations_project_schedule_idx"
  ON "crawl_automations"(
    "workspace_id",
    "project_id",
    "enabled",
    "next_run_at"
  );

CREATE TABLE "crawl_automation_runs" (
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
  "crawl_id" UUID,
  "job_id" UUID,
  "error_code" VARCHAR(100),
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "crawl_automation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crawl_automation_runs_automation_tenant_fkey"
    FOREIGN KEY ("automation_id", "workspace_id", "project_id")
    REFERENCES "crawl_automations"("id", "workspace_id", "project_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "crawl_automation_runs_crawl_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "crawl_id")
    REFERENCES "technical_crawls"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "crawl_automation_runs_job_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES "jobs"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "crawl_automation_runs_lifecycle_check" CHECK (
    ("crawl_id" IS NULL) = ("job_id" IS NULL)
    AND (
      (
        "status" = 'RUNNING'
        AND "started_at" IS NOT NULL
        AND "finished_at" IS NULL
        AND "crawl_id" IS NULL
        AND "error_code" IS NULL
      )
      OR (
        "status" = 'DISPATCHED'
        AND "started_at" IS NOT NULL
        AND "finished_at" IS NULL
        AND "crawl_id" IS NOT NULL
        AND "error_code" IS NULL
      )
      OR (
        "status" = 'SKIPPED'
        AND "started_at" IS NULL
        AND "finished_at" IS NOT NULL
        AND "crawl_id" IS NULL
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
        AND "crawl_id" IS NOT NULL
        AND "error_code" IS NULL
      )
    )
  ),
  CONSTRAINT "crawl_automation_runs_values_check" CHECK (
    "automation_version" >= 1
    AND jsonb_typeof("definition") = 'object'
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
  CONSTRAINT "crawl_automation_runs_trigger_idempotency_check" CHECK (
    (
      "trigger" = 'SCHEDULE'
      AND "idempotency_key" IS NULL
    )
    OR (
      "trigger" = 'MANUAL'
      AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$'
    )
  )
);

CREATE UNIQUE INDEX "crawl_automation_runs_schedule_key"
  ON "crawl_automation_runs"("automation_id", "scheduled_for");
CREATE UNIQUE INDEX "crawl_automation_runs_manual_idempotency_key"
  ON "crawl_automation_runs"(
    "automation_id",
    "actor_id",
    "idempotency_key"
  );
CREATE INDEX "crawl_automation_runs_tenant_created_idx"
  ON "crawl_automation_runs"(
    "workspace_id",
    "project_id",
    "automation_id",
    "created_at"
  );
CREATE INDEX "crawl_automation_runs_status_created_idx"
  ON "crawl_automation_runs"("status", "created_at");

CREATE FUNCTION "guard_crawl_automation_run"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."automation_id" IS DISTINCT FROM OLD."automation_id"
    OR NEW."automation_version" IS DISTINCT FROM OLD."automation_version"
    OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
    OR NEW."project_id" IS DISTINCT FROM OLD."project_id"
    OR NEW."trigger" IS DISTINCT FROM OLD."trigger"
    OR NEW."scheduled_for" IS DISTINCT FROM OLD."scheduled_for"
    OR NEW."actor_id" IS DISTINCT FROM OLD."actor_id"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."definition" IS DISTINCT FROM OLD."definition"
    OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'crawl automation run identity is immutable';
  END IF;

  IF OLD."status" IN ('SKIPPED', 'COMPLETED', 'FAILED')
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'terminal crawl automation run is immutable';
  END IF;

  IF NEW."status" <> OLD."status"
    AND NOT (
      (OLD."status" = 'RUNNING' AND NEW."status" IN ('DISPATCHED', 'FAILED'))
      OR
      (OLD."status" = 'DISPATCHED' AND NEW."status" IN ('COMPLETED', 'FAILED'))
    )
  THEN
    RAISE EXCEPTION 'invalid crawl automation run transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "crawl_automation_runs_guard"
BEFORE UPDATE ON "crawl_automation_runs"
FOR EACH ROW EXECUTE FUNCTION "guard_crawl_automation_run"();

COMMIT;
