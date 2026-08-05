CREATE TYPE "ProjectTransferStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED'
);

ALTER TABLE "projects"
  ADD COLUMN "owner_user_id" UUID;

UPDATE "projects" AS project
SET "owner_user_id" = workspace."owner_user_id"
FROM "workspaces" AS workspace
WHERE workspace."id" = project."workspace_id";

ALTER TABLE "projects"
  ALTER COLUMN "owner_user_id" SET NOT NULL;

CREATE INDEX "projects_owner_user_id_status_idx"
  ON "projects"("owner_user_id", "status");

CREATE TABLE "project_transfer_requests" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "from_user_id" UUID NOT NULL,
  "to_user_id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "status" "ProjectTransferStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "declined_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_transfer_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_transfer_requests_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_transfer_requests_distinct_users_check"
    CHECK ("from_user_id" <> "to_user_id"),
  CONSTRAINT "project_transfer_requests_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "project_transfer_requests_terminal_state_check"
    CHECK (
      ("status" = 'PENDING'
        AND "accepted_at" IS NULL
        AND "declined_at" IS NULL
        AND "cancelled_at" IS NULL)
      OR ("status" = 'ACCEPTED'
        AND "accepted_at" IS NOT NULL
        AND "declined_at" IS NULL
        AND "cancelled_at" IS NULL)
      OR ("status" = 'DECLINED'
        AND "accepted_at" IS NULL
        AND "declined_at" IS NOT NULL
        AND "cancelled_at" IS NULL)
      OR ("status" = 'CANCELLED'
        AND "accepted_at" IS NULL
        AND "declined_at" IS NULL
        AND "cancelled_at" IS NOT NULL)
      OR ("status" = 'EXPIRED'
        AND "accepted_at" IS NULL
        AND "declined_at" IS NULL
        AND "cancelled_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "project_transfer_requests_one_pending_per_project_key"
  ON "project_transfer_requests"("project_id")
  WHERE "status" = 'PENDING';

CREATE INDEX "project_transfer_requests_to_user_id_status_expires_at_idx"
  ON "project_transfer_requests"("to_user_id", "status", "expires_at");

CREATE INDEX "project_transfer_requests_project_id_status_created_at_idx"
  ON "project_transfer_requests"("project_id", "status", "created_at");
