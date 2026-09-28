ALTER TABLE "uploads"
  ADD COLUMN "object_deleted_at" TIMESTAMPTZ(6);

CREATE INDEX "uploads_retention_idx"
  ON "uploads"("created_at", "id")
  WHERE "object_deleted_at" IS NULL;

CREATE INDEX "jobs_export_retention_idx"
  ON "jobs"("finished_at", "id")
  WHERE "type" = 'SEMANTIC_EXPORT'
    AND "status" = 'COMPLETED'
    AND "stage" = 'completed';
