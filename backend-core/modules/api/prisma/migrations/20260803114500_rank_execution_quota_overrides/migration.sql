BEGIN;

CREATE TABLE "rank_execution_quota_overrides" (
  "workspace_id" UUID NOT NULL,
  "daily_task_limit" INTEGER NOT NULL,
  "reason" VARCHAR(255) NOT NULL,
  "expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_execution_quota_overrides_pkey"
    PRIMARY KEY ("workspace_id"),
  CONSTRAINT "rank_execution_quota_overrides_limit_check"
    CHECK ("daily_task_limit" BETWEEN 1 AND 1000000),
  CONSTRAINT "rank_execution_quota_overrides_expiry_check"
    CHECK ("expires_at" IS NULL OR "expires_at" > "created_at"),
  CONSTRAINT "rank_execution_quota_overrides_workspace_fkey"
    FOREIGN KEY ("workspace_id")
    REFERENCES "workspaces" ("id")
    ON DELETE CASCADE
    ON UPDATE RESTRICT
);

CREATE INDEX "rank_execution_quota_overrides_expires_at_idx"
  ON "rank_execution_quota_overrides" ("expires_at");

REVOKE ALL ON TABLE "rank_execution_quota_overrides" FROM PUBLIC;

COMMIT;
