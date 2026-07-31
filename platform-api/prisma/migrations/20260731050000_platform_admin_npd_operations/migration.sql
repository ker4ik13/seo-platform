BEGIN;

CREATE TYPE "PlatformRoleCode" AS ENUM (
  'SUPER_ADMIN',
  'OPERATIONS',
  'SUPPORT',
  'FINANCE',
  'CONTENT',
  'SECURITY_AUDITOR',
  'ANALYST'
);

CREATE TABLE "platform_staff_role_assignments" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "user_id" UUID NOT NULL,
  "role_code" "PlatformRoleCode" NOT NULL,
  "assigned_by" UUID,
  "reason" VARCHAR(500) NOT NULL,
  "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),
  "revoked_by" UUID,
  "revoke_reason" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "platform_staff_role_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_staff_role_assignments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_staff_role_assignments_assigned_by_fkey"
    FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_staff_role_assignments_revoked_by_fkey"
    FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_staff_role_assignments_revocation_check"
    CHECK (
      ("revoked_at" IS NULL AND "revoked_by" IS NULL AND "revoke_reason" IS NULL)
      OR
      ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL AND length(trim("revoke_reason")) >= 8)
    )
);

CREATE INDEX "platform_staff_role_assignments_user_id_revoked_at_idx"
  ON "platform_staff_role_assignments"("user_id", "revoked_at");
CREATE INDEX "platform_staff_role_assignments_role_code_revoked_at_idx"
  ON "platform_staff_role_assignments"("role_code", "revoked_at");
CREATE UNIQUE INDEX "platform_staff_role_assignments_active_user_role_key"
  ON "platform_staff_role_assignments"("user_id", "role_code")
  WHERE "revoked_at" IS NULL;

CREATE OR REPLACE FUNCTION protect_platform_staff_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'platform staff role assignments are append-only';
  END IF;
  IF OLD."revoked_at" IS NOT NULL THEN
    RAISE EXCEPTION 'revoked platform staff role assignments are immutable';
  END IF;
  IF NEW."user_id" <> OLD."user_id"
     OR NEW."role_code" <> OLD."role_code"
     OR NEW."assigned_by" IS DISTINCT FROM OLD."assigned_by"
     OR NEW."reason" <> OLD."reason"
     OR NEW."assigned_at" <> OLD."assigned_at"
     OR NEW."id" <> OLD."id"
     OR NEW."version" <> OLD."version" + 1
     OR NEW."revoked_at" IS NULL
     OR NEW."revoked_by" IS NULL
     OR NEW."revoke_reason" IS NULL THEN
    RAISE EXCEPTION 'only one audited active-to-revoked transition is allowed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "platform_staff_role_assignments_protect_update_delete"
BEFORE UPDATE OR DELETE ON "platform_staff_role_assignments"
FOR EACH ROW EXECUTE FUNCTION protect_platform_staff_role_assignment();

CREATE OR REPLACE FUNCTION prevent_platform_staff_role_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform staff role assignments cannot be truncated';
END;
$$;

CREATE TRIGGER "platform_staff_role_assignments_protect_truncate"
BEFORE TRUNCATE ON "platform_staff_role_assignments"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_staff_role_truncate();

DROP INDEX "npd_receipt_obligations_payment_id_key";
DROP INDEX "npd_receipt_obligations_yookassa_payment_id_key";

ALTER TABLE "npd_receipt_obligations"
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "cancellation_official_reference" VARCHAR(255),
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "npd_receipt_obligations_payment_sequence_key"
  ON "npd_receipt_obligations"("payment_id", "sequence");
CREATE INDEX "npd_receipt_obligations_yookassa_payment_id_idx"
  ON "npd_receipt_obligations"("yookassa_payment_id");

ALTER TABLE "npd_receipt_obligations"
  ADD CONSTRAINT "npd_receipt_obligations_sequence_check"
    CHECK ("sequence" > 0),
  ADD CONSTRAINT "npd_receipt_obligations_registration_check"
    CHECK (
      ("status" IN ('REGISTERED', 'DELIVERY_PENDING', 'DELIVERED', 'CANCELLED')
        AND "official_receipt_id" IS NOT NULL
        AND "official_receipt_url" IS NOT NULL
        AND "registered_at" IS NOT NULL)
      OR
      ("status" NOT IN ('REGISTERED', 'DELIVERY_PENDING', 'DELIVERED', 'CANCELLED'))
    ),
  ADD CONSTRAINT "npd_receipt_obligations_cancellation_check"
    CHECK (
      ("status" = 'CANCELLED'
        AND "cancelled_at" IS NOT NULL
        AND "cancellation_official_reference" IS NOT NULL
        AND "cancellation_reason" IS NOT NULL)
      OR "status" <> 'CANCELLED'
    );

COMMIT;
