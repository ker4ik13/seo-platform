ALTER TYPE "ProjectTransferStatus" ADD VALUE 'PROCESSING' AFTER 'PENDING';

DROP INDEX "project_transfer_requests_one_pending_per_project_key";

ALTER TABLE "project_transfer_requests"
  DROP CONSTRAINT "project_transfer_requests_terminal_state_check",
  ADD COLUMN "destination_workspace_id" UUID,
  ADD COLUMN "source_project_status" "ProjectStatus",
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reconcile_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_error_code" VARCHAR(64),
  ADD COLUMN "processing_started_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "project_transfer_requests_source_workspace_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_transfer_requests_destination_workspace_fkey"
    FOREIGN KEY ("destination_workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_transfer_requests_attempt_count_check"
    CHECK ("attempt_count" >= 0),
  ADD CONSTRAINT "project_transfer_requests_workspace_change_check"
    CHECK (
      "destination_workspace_id" IS NULL
      OR "destination_workspace_id" <> "workspace_id"
    ),
  ADD CONSTRAINT "project_transfer_requests_terminal_state_check"
    CHECK (
      ("status" = 'PENDING'
        AND "destination_workspace_id" IS NULL
        AND "source_project_status" IS NULL
        AND "processing_started_at" IS NULL
        AND "accepted_at" IS NULL
        AND "declined_at" IS NULL
        AND "cancelled_at" IS NULL)
      OR ("status" = 'PROCESSING'
        AND "destination_workspace_id" IS NOT NULL
        AND "source_project_status" IS NOT NULL
        AND "processing_started_at" IS NOT NULL
        AND "accepted_at" IS NULL
        AND "declined_at" IS NULL
        AND "cancelled_at" IS NULL)
      OR ("status" = 'ACCEPTED'
        AND "accepted_at" IS NOT NULL
        AND "declined_at" IS NULL
        AND "cancelled_at" IS NULL
        AND (
          ("destination_workspace_id" IS NULL
            AND "source_project_status" IS NULL
            AND "processing_started_at" IS NULL)
          OR ("destination_workspace_id" IS NOT NULL
            AND "source_project_status" IS NOT NULL
            AND "processing_started_at" IS NOT NULL)
        ))
      OR ("status" = 'DECLINED'
        AND "destination_workspace_id" IS NULL
        AND "source_project_status" IS NULL
        AND "processing_started_at" IS NULL
        AND "accepted_at" IS NULL
        AND "declined_at" IS NOT NULL
        AND "cancelled_at" IS NULL)
      OR ("status" = 'CANCELLED'
        AND "destination_workspace_id" IS NULL
        AND "source_project_status" IS NULL
        AND "processing_started_at" IS NULL
        AND "accepted_at" IS NULL
        AND "declined_at" IS NULL
        AND "cancelled_at" IS NOT NULL)
      OR ("status" = 'EXPIRED'
        AND "destination_workspace_id" IS NULL
        AND "source_project_status" IS NULL
        AND "processing_started_at" IS NULL
        AND "accepted_at" IS NULL
        AND "declined_at" IS NULL
        AND "cancelled_at" IS NULL)
    );

CREATE UNIQUE INDEX "project_transfer_requests_one_active_per_project_key"
  ON "project_transfer_requests"("project_id")
  WHERE "status" IN ('PENDING', 'PROCESSING');

CREATE INDEX "project_transfer_requests_status_next_attempt_at_created_at_idx"
  ON "project_transfer_requests"("status", "next_attempt_at", "created_at");

CREATE INDEX "project_transfer_requests_destination_workspace_id_status_idx"
  ON "project_transfer_requests"("destination_workspace_id", "status");
