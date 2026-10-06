CREATE TABLE "operational_error_events" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "environment" VARCHAR(64) NOT NULL,
  "service_version" VARCHAR(64) NOT NULL,
  "service" VARCHAR(64) NOT NULL,
  "source" VARCHAR(64) NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "severity" VARCHAR(16) NOT NULL,
  "fingerprint" VARCHAR(64),
  "workspace_id" UUID,
  "project_id" UUID,
  "operation_id" UUID,
  "context" JSONB,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "operational_error_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_error_events_severity_check"
    CHECK ("severity" IN ('ERROR', 'CRITICAL'))
);

CREATE INDEX "operational_error_events_retention_idx"
  ON "operational_error_events"("occurred_at", "id");
CREATE INDEX "operational_error_events_project_idx"
  ON "operational_error_events"("project_id", "occurred_at" DESC);
CREATE INDEX "operational_error_events_operation_idx"
  ON "operational_error_events"("operation_id", "occurred_at" DESC);
CREATE INDEX "operational_error_events_code_idx"
  ON "operational_error_events"("code", "occurred_at" DESC);
