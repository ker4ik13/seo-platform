ALTER TABLE "automations"
ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

CREATE INDEX "automations_tenant_active_created_idx"
ON "automations" (
  "workspace_id",
  "project_id",
  "deleted_at",
  "created_at" DESC,
  "id"
);
