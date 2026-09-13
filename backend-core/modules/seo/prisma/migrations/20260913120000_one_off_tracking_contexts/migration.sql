ALTER TABLE "tracking_contexts"
ADD COLUMN "is_reusable" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "tracking_contexts_reusable_status_created_idx"
ON "tracking_contexts" (
  "workspace_id",
  "project_id",
  "is_reusable",
  "status",
  "created_at" DESC,
  "id"
);
