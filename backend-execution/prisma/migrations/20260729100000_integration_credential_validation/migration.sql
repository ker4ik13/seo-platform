BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "jobs") THEN
    RAISE EXCEPTION
      'job idempotency migration requires an empty pre-release jobs table';
  END IF;
END
$$;

DROP INDEX "jobs_workspace_id_idempotency_key_key";
DROP INDEX "jobs_deduplication_key_status_idx";

ALTER TABLE "jobs"
  ADD COLUMN "idempotency_scope" VARCHAR(180) NOT NULL,
  ADD COLUMN "request_hash" BYTEA,
  ADD COLUMN "lease_owner" VARCHAR(100),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "retry_at" TIMESTAMPTZ(6),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL;

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_idempotency_scope_not_blank"
    CHECK (length(btrim("idempotency_scope")) > 0),
  ADD CONSTRAINT "jobs_idempotency_request_hash_pair"
    CHECK (
      ("idempotency_key" IS NULL AND "request_hash" IS NULL)
      OR
      (
        "idempotency_key" IS NOT NULL
        AND "request_hash" IS NOT NULL
        AND octet_length("request_hash") = 32
      )
    );

CREATE UNIQUE INDEX
  "jobs_workspace_id_idempotency_scope_idempotency_key_key"
  ON "jobs" ("workspace_id", "idempotency_scope", "idempotency_key");

CREATE UNIQUE INDEX "jobs_active_deduplication_key"
  ON "jobs" ("workspace_id", "deduplication_key")
  WHERE "deduplication_key" IS NOT NULL
    AND "status" IN (
      'QUEUED',
      'WAITING_RATE_LIMIT',
      'RUNNING',
      'RETRY_SCHEDULED'
    );

CREATE INDEX "jobs_workspace_id_deduplication_key_status_idx"
  ON "jobs" ("workspace_id", "deduplication_key", "status");

CREATE INDEX "jobs_type_status_lease_expires_at_created_at_idx"
  ON "jobs" ("type", "status", "lease_expires_at", "created_at");

CREATE INDEX "jobs_type_status_retry_at_priority_created_at_idx"
  ON "jobs" ("type", "status", "retry_at", "priority", "created_at");

ALTER TABLE "integration_credentials"
  ADD COLUMN "material_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "last_error_code" VARCHAR(100),
  ADD CONSTRAINT "integration_credentials_material_version_positive"
    CHECK ("material_version" > 0);

COMMIT;
