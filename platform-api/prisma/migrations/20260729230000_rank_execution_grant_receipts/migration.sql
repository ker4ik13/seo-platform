BEGIN;

DO $$
BEGIN
  IF to_regclass('public.rank_execution_grant_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'rank_execution_grant_receipts already exists';
  END IF;
END
$$;

CREATE TYPE "RankExecutionGrantDecision" AS ENUM (
  'GRANTED',
  'DENIED'
);

CREATE TYPE "RankExecutionGrantDenialReason" AS ENUM (
  'WORKSPACE_NOT_ACTIVE',
  'PROJECT_NOT_ACTIVE',
  'PROJECT_VERSION_CHANGED',
  'MEMBERSHIP_NOT_ACTIVE',
  'MEMBERSHIP_VERSION_CHANGED',
  'RUN_PERMISSION_DENIED',
  'ENTITLEMENT_NOT_AVAILABLE',
  'ENTITLEMENT_DENIED',
  'QUOTA_NOT_AVAILABLE',
  'QUOTA_EXHAUSTED'
);

CREATE TABLE "rank_execution_grant_receipts" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "job_item_id" UUID NOT NULL,
  "execution_attempt" INTEGER NOT NULL,
  "project_version" INTEGER NOT NULL,
  "membership_version" INTEGER NOT NULL,
  "policy_version" VARCHAR(64) NOT NULL,
  "idempotency_scope" VARCHAR(180) NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "scope_hash" BYTEA NOT NULL,
  "request_snapshot" JSONB NOT NULL,
  "response_snapshot" JSONB NOT NULL,
  "decision" "RankExecutionGrantDecision" NOT NULL,
  "denial_reason" "RankExecutionGrantDenialReason",
  "decided_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6),
  "quota_reservation_id" UUID,
  "correlation_id" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_execution_grant_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rank_execution_grants_execution_attempt_check"
    CHECK ("execution_attempt" BETWEEN 1 AND 1000),
  CONSTRAINT "rank_execution_grants_project_version_check"
    CHECK ("project_version" > 0),
  CONSTRAINT "rank_execution_grants_membership_version_check"
    CHECK ("membership_version" > 0),
  CONSTRAINT "rank_execution_grants_request_hash_check"
    CHECK (octet_length("request_hash") = 32),
  CONSTRAINT "rank_execution_grants_scope_hash_check"
    CHECK (octet_length("scope_hash") = 32),
  CONSTRAINT "rank_execution_grants_request_snapshot_check"
    CHECK (
      jsonb_typeof("request_snapshot") = 'object'
      AND pg_column_size("request_snapshot") <= 65536
    ),
  CONSTRAINT "rank_execution_grants_response_snapshot_check"
    CHECK (
      jsonb_typeof("response_snapshot") = 'object'
      AND pg_column_size("response_snapshot") <= 65536
    ),
  CONSTRAINT "rank_execution_grants_policy_version_check"
    CHECK (
      "policy_version" ~ '^[a-z0-9][a-z0-9@._-]{0,63}$'
    ),
  CONSTRAINT "rank_execution_grants_idempotency_scope_check"
    CHECK (
      length("idempotency_scope") BETWEEN 1 AND 180
      AND "idempotency_scope" = btrim("idempotency_scope")
    ),
  CONSTRAINT "rank_execution_grants_idempotency_key_check"
    CHECK (
      "idempotency_key" ~ '^[A-Za-z0-9._:-]{16,180}$'
    ),
  CONSTRAINT "rank_execution_grants_correlation_id_check"
    CHECK (
      "correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
    ),
  CONSTRAINT "rank_execution_grants_timestamps_check"
    CHECK (
      isfinite("decided_at")
      AND ("expires_at" IS NULL OR isfinite("expires_at"))
      AND isfinite("created_at")
    ),
  CONSTRAINT "rank_execution_grants_decision_check"
    CHECK (
      (
        "decision" = 'GRANTED'
        AND "denial_reason" IS NULL
        AND "expires_at" IS NOT NULL
        AND "expires_at" = "decided_at" + INTERVAL '30 seconds'
        AND "quota_reservation_id" IS NOT NULL
      )
      OR
      (
        "decision" = 'DENIED'
        AND "denial_reason" IS NOT NULL
        AND "expires_at" IS NULL
        AND "quota_reservation_id" IS NULL
      )
    )
);

CREATE UNIQUE INDEX "rank_execution_grants_workspace_idempotency_key"
  ON "rank_execution_grant_receipts" (
    "workspace_id",
    "idempotency_scope",
    "idempotency_key"
  );

CREATE UNIQUE INDEX "rank_execution_grants_item_attempt_key"
  ON "rank_execution_grant_receipts" (
    "workspace_id",
    "job_item_id",
    "execution_attempt"
  );

CREATE INDEX "rank_execution_grants_tenant_decided_idx"
  ON "rank_execution_grant_receipts" (
    "workspace_id",
    "project_id",
    "decided_at"
  );

CREATE INDEX "rank_execution_grants_expiry_idx"
  ON "rank_execution_grant_receipts" ("expires_at", "id");

CREATE FUNCTION "protect_rank_execution_grant_receipt"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rank execution grant receipts are immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_execution_grant_receipt_immutable"
  BEFORE UPDATE OR DELETE ON "rank_execution_grant_receipts"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_rank_execution_grant_receipt"();

CREATE FUNCTION "deny_rank_execution_grant_receipt_truncate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rank execution grant receipts cannot be truncated'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_execution_grant_receipt_no_truncate"
  BEFORE TRUNCATE ON "rank_execution_grant_receipts"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "deny_rank_execution_grant_receipt_truncate"();

COMMIT;
