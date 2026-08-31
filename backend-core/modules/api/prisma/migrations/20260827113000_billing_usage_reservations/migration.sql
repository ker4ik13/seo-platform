BEGIN;

CREATE TYPE "BillingUsageReservationStatus" AS ENUM (
  'RESERVED',
  'CAPTURED',
  'RELEASED'
);

CREATE TABLE "billing_usage_reservations" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "job_item_id" UUID NOT NULL,
  "execution_attempt" INTEGER NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "operation" VARCHAR(64) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price_minor" BIGINT NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "included_amount_minor" BIGINT NOT NULL,
  "prepaid_amount_minor" BIGINT NOT NULL,
  "status" "BillingUsageReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "business_reference" VARCHAR(180) NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "reservation_transaction_id" UUID NOT NULL,
  "capture_transaction_id" UUID,
  "release_transaction_id" UUID,
  "reserved_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "captured_at" TIMESTAMPTZ(6),
  "released_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "billing_usage_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_usage_reservations_workspace_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "billing_usage_reservations_reservation_transaction_fkey"
    FOREIGN KEY ("reservation_transaction_id")
    REFERENCES "billing_ledger_transactions"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "billing_usage_reservations_capture_transaction_fkey"
    FOREIGN KEY ("capture_transaction_id")
    REFERENCES "billing_ledger_transactions"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "billing_usage_reservations_release_transaction_fkey"
    FOREIGN KEY ("release_transaction_id")
    REFERENCES "billing_ledger_transactions"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "billing_usage_reservations_identity_check" CHECK (
    "execution_attempt" BETWEEN 1 AND 1000
    AND "provider" IN ('ARSENKIN', 'XMLSTOCK')
    AND "operation" = 'POSITIONS'
  ),
  CONSTRAINT "billing_usage_reservations_amount_check" CHECK (
    "quantity" > 0
    AND "unit_price_minor" > 0
    AND "amount_minor" = "unit_price_minor" * "quantity"
    AND "included_amount_minor" >= 0
    AND "prepaid_amount_minor" >= 0
    AND "included_amount_minor" + "prepaid_amount_minor" = "amount_minor"
  ),
  CONSTRAINT "billing_usage_reservations_window_check" CHECK (
    "expires_at" > "reserved_at"
  ),
  CONSTRAINT "billing_usage_reservations_state_check" CHECK (
    (
      "status" = 'RESERVED'
      AND "capture_transaction_id" IS NULL
      AND "release_transaction_id" IS NULL
      AND "captured_at" IS NULL
      AND "released_at" IS NULL
    )
    OR (
      "status" = 'CAPTURED'
      AND "capture_transaction_id" IS NOT NULL
      AND "release_transaction_id" IS NULL
      AND "captured_at" IS NOT NULL
      AND "captured_at" >= "reserved_at"
      AND "captured_at" < "expires_at"
      AND "released_at" IS NULL
    )
    OR (
      "status" = 'RELEASED'
      AND "capture_transaction_id" IS NULL
      AND "release_transaction_id" IS NOT NULL
      AND "captured_at" IS NULL
      AND "released_at" IS NOT NULL
      AND "released_at" >= "reserved_at"
    )
  )
);

CREATE UNIQUE INDEX "billing_usage_reservations_business_reference_key"
  ON "billing_usage_reservations"("business_reference");
CREATE UNIQUE INDEX "billing_usage_reservations_item_attempt_key"
  ON "billing_usage_reservations"(
    "workspace_id", "job_item_id", "execution_attempt"
  );
CREATE INDEX "billing_usage_reservations_expiry_idx"
  ON "billing_usage_reservations"("workspace_id", "status", "expires_at");
CREATE INDEX "billing_usage_reservations_project_idx"
  ON "billing_usage_reservations"("workspace_id", "project_id", "created_at");

CREATE OR REPLACE FUNCTION "billing_guard_usage_reservation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing usage reservations are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
      OR NEW."project_id" IS DISTINCT FROM OLD."project_id"
      OR NEW."actor_id" IS DISTINCT FROM OLD."actor_id"
      OR NEW."job_id" IS DISTINCT FROM OLD."job_id"
      OR NEW."job_item_id" IS DISTINCT FROM OLD."job_item_id"
      OR NEW."execution_attempt" IS DISTINCT FROM OLD."execution_attempt"
      OR NEW."provider" IS DISTINCT FROM OLD."provider"
      OR NEW."operation" IS DISTINCT FROM OLD."operation"
      OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
      OR NEW."unit_price_minor" IS DISTINCT FROM OLD."unit_price_minor"
      OR NEW."amount_minor" IS DISTINCT FROM OLD."amount_minor"
      OR NEW."included_amount_minor" IS DISTINCT FROM OLD."included_amount_minor"
      OR NEW."prepaid_amount_minor" IS DISTINCT FROM OLD."prepaid_amount_minor"
      OR NEW."business_reference" IS DISTINCT FROM OLD."business_reference"
      OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
      OR NEW."reservation_transaction_id" IS DISTINCT FROM OLD."reservation_transaction_id"
      OR NEW."reserved_at" IS DISTINCT FROM OLD."reserved_at"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    THEN
      RAISE EXCEPTION 'billing usage reservation economics are immutable'
      USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
      AND (
        OLD."status" <> 'RESERVED'
        OR NEW."status" <> 'RESERVED'
        OR NEW."expires_at" <= OLD."expires_at"
        OR NEW."expires_at" > clock_timestamp() + interval '2 minutes'
      )
    THEN
      RAISE EXCEPTION 'invalid billing usage reservation hold'
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD."status" <> 'RESERVED'
      AND NEW."status" IS DISTINCT FROM OLD."status"
    THEN
      RAISE EXCEPTION 'terminal billing usage reservation cannot transition'
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD."status" <> 'RESERVED'
      AND (
        NEW."capture_transaction_id" IS DISTINCT FROM OLD."capture_transaction_id"
        OR NEW."release_transaction_id" IS DISTINCT FROM OLD."release_transaction_id"
        OR NEW."captured_at" IS DISTINCT FROM OLD."captured_at"
        OR NEW."released_at" IS DISTINCT FROM OLD."released_at"
      )
    THEN
      RAISE EXCEPTION 'terminal billing usage settlement is immutable'
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD."status" = 'RESERVED'
      AND NEW."status" NOT IN ('RESERVED', 'CAPTURED', 'RELEASED')
    THEN
      RAISE EXCEPTION 'invalid billing usage reservation transition'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$$;

CREATE TRIGGER "billing_usage_reservations_immutable"
BEFORE UPDATE OR DELETE ON "billing_usage_reservations"
FOR EACH ROW EXECUTE FUNCTION "billing_guard_usage_reservation"();

CREATE TRIGGER "billing_usage_reservations_no_truncate"
BEFORE TRUNCATE ON "billing_usage_reservations"
FOR EACH STATEMENT EXECUTE FUNCTION "billing_reject_ledger_truncate"();

COMMIT;
