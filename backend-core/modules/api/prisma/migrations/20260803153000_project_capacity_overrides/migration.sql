CREATE TABLE "project_capacity_overrides" (
  "workspace_id" UUID NOT NULL,
  "project_limit" INTEGER NOT NULL,
  "reason" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_capacity_overrides_pkey" PRIMARY KEY ("workspace_id"),
  CONSTRAINT "project_capacity_overrides_project_limit_check"
    CHECK ("project_limit" BETWEEN 1 AND 100000),
  CONSTRAINT "project_capacity_overrides_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

REVOKE ALL ON TABLE "project_capacity_overrides" FROM PUBLIC;
