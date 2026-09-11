ALTER TABLE "jobs"
  ADD COLUMN "dismissed_at" TIMESTAMPTZ(6),
  ADD COLUMN "dismissed_by" UUID;

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_dismissal_pair_check"
    CHECK (("dismissed_at" IS NULL) = ("dismissed_by" IS NULL)) NOT VALID,
  ADD CONSTRAINT "jobs_dismissal_terminal_error_check"
    CHECK (
      "dismissed_at" IS NULL OR
      "status"::text IN ('FAILED_FINAL', 'ACTION_REQUIRED', 'EXPIRED')
    ) NOT VALID;

ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_dismissal_pair_check";
ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_dismissal_terminal_error_check";

CREATE INDEX "jobs_project_dismissed_created_idx"
  ON "jobs" ("workspace_id", "project_id", "dismissed_at", "created_at", "id");
