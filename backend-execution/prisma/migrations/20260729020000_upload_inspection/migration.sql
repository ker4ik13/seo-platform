ALTER TABLE "uploads"
  ADD COLUMN "detected_media_type" VARCHAR(255),
  ADD COLUMN "inspection_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "inspection_heartbeat_at" TIMESTAMPTZ(6),
  ADD COLUMN "inspection_completed_at" TIMESTAMPTZ(6);

CREATE INDEX "uploads_status_inspection_heartbeat_at_uploaded_at_idx"
  ON "uploads"("status", "inspection_heartbeat_at", "uploaded_at");
