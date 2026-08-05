BEGIN;

LOCK TABLE "rank_execution_manifests"
IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "rank_execution_manifests"
  ) THEN
    RAISE EXCEPTION
      'rank-manifest@1 expiry hardening requires an empty manifest table'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE "rank_execution_manifests"
ADD COLUMN "estimate_expires_at" TIMESTAMPTZ(6) NOT NULL;

ALTER TABLE "rank_execution_manifests"
ADD CONSTRAINT "rank_execution_manifests_estimate_expiry"
CHECK ("estimate_expires_at" > "sealed_at");

CREATE TYPE "RankCheckFinalStatus"
AS ENUM (
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'CANCELLED',
  'FAILED',
  'ACTION_REQUIRED'
);

CREATE UNIQUE INDEX
  "rank_execution_manifests_tenant_project_id_job_key"
ON "rank_execution_manifests"(
  "workspace_id",
  "project_id",
  "id",
  "job_id"
);

CREATE TABLE "rank_check_finalization_receipts" (
  "manifest_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "finalized_by" UUID NOT NULL,
  "schema_version" VARCHAR(32) NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "tracking_context_id" UUID NOT NULL,
  "configuration_version" INTEGER NOT NULL,
  "status" "RankCheckFinalStatus" NOT NULL,
  "pair_count" INTEGER NOT NULL,
  "persisted_count" INTEGER NOT NULL,
  "found_count" INTEGER NOT NULL,
  "not_found_count" INTEGER NOT NULL,
  "missing_count" INTEGER NOT NULL,
  "finalized_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "rank_check_finalization_receipts_pkey"
    PRIMARY KEY ("manifest_id"),
  CONSTRAINT "rank_check_finalization_receipts_schema"
    CHECK ("schema_version" = 'rank-finalize@1'),
  CONSTRAINT "rank_check_finalization_receipts_request_hash_size"
    CHECK (octet_length("request_hash") = 32),
  CONSTRAINT "rank_check_finalization_receipts_configuration_version"
    CHECK ("configuration_version" > 0),
  CONSTRAINT "rank_check_finalization_receipts_zero_result_boundary"
    CHECK (
      "status" IN ('CANCELLED', 'FAILED', 'ACTION_REQUIRED')
      AND "pair_count" BETWEEN 1 AND 1000
      AND "persisted_count" = 0
      AND "found_count" = 0
      AND "not_found_count" = 0
      AND "missing_count" = "pair_count"
    )
);

CREATE UNIQUE INDEX
  "rank_final_receipts_tenant_manifest_job_key"
ON "rank_check_finalization_receipts"(
  "workspace_id",
  "project_id",
  "manifest_id",
  "job_id"
);

CREATE UNIQUE INDEX
  "rank_check_finalization_receipts_tenant_project_job_key"
ON "rank_check_finalization_receipts"(
  "workspace_id",
  "project_id",
  "job_id"
);

CREATE INDEX
  "rank_check_finalization_receipts_context_finalized_idx"
ON "rank_check_finalization_receipts"(
  "workspace_id",
  "project_id",
  "tracking_context_id",
  "finalized_at" DESC
);

ALTER TABLE "rank_check_finalization_receipts"
ADD CONSTRAINT
  "rank_check_finalization_receipts_manifest_tenant_fkey"
FOREIGN KEY (
  "workspace_id",
  "project_id",
  "manifest_id",
  "job_id"
)
REFERENCES "rank_execution_manifests"(
  "workspace_id",
  "project_id",
  "id",
  "job_id"
)
ON DELETE RESTRICT
ON UPDATE RESTRICT;

CREATE FUNCTION "guard_rank_check_finalization_receipt_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "stored_manifest" "rank_execution_manifests"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT *
    INTO "stored_manifest"
    FROM "rank_execution_manifests"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "project_id" = NEW."project_id"
      AND "id" = NEW."manifest_id"
      AND "job_id" = NEW."job_id";

    IF FOUND
      AND "stored_manifest"."status" = 'CLOSED'
      AND "stored_manifest"."closed_at" = NEW."finalized_at"
      AND "stored_manifest"."tracking_context_id"
        = NEW."tracking_context_id"
      AND "stored_manifest"."configuration_version"
        = NEW."configuration_version"
      AND "stored_manifest"."pair_count" = NEW."pair_count"
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'rank check finalization receipt is immutable or invalid'
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION "require_rank_execution_manifest_finalization_at_commit"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'CLOSED'
    AND NOT EXISTS (
      SELECT 1
      FROM "rank_check_finalization_receipts" AS "receipt"
      WHERE "receipt"."workspace_id" = NEW."workspace_id"
        AND "receipt"."project_id" = NEW."project_id"
        AND "receipt"."manifest_id" = NEW."id"
        AND "receipt"."job_id" = NEW."job_id"
        AND "receipt"."tracking_context_id"
          = NEW."tracking_context_id"
        AND "receipt"."configuration_version"
          = NEW."configuration_version"
        AND "receipt"."pair_count" = NEW."pair_count"
        AND "receipt"."finalized_at" = NEW."closed_at"
    )
  THEN
    RAISE EXCEPTION 'closed rank execution manifest requires a receipt'
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION "reject_rank_check_finalization_receipt_truncate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rank check finalization receipts cannot be truncated'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "rank_check_finalization_receipts_immutable"
BEFORE INSERT OR UPDATE OR DELETE
ON "rank_check_finalization_receipts"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_check_finalization_receipt_mutation"();

CREATE TRIGGER "rank_check_finalization_receipts_no_truncate"
BEFORE TRUNCATE ON "rank_check_finalization_receipts"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_rank_check_finalization_receipt_truncate"();

CREATE CONSTRAINT TRIGGER
  "rank_execution_manifests_finalized_at_commit"
AFTER UPDATE ON "rank_execution_manifests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION
  "require_rank_execution_manifest_finalization_at_commit"();

COMMIT;
