BEGIN;

CREATE TYPE "AuthEmailDeliveryStatus" AS ENUM (
  'PENDING',
  'SENDING',
  'RETRY_SCHEDULED',
  'SMTP_ACCEPTED',
  'DLQ_PENDING',
  'COMPLETED',
  'CANCELLED',
  'FAILED_FINAL'
);

CREATE TABLE "auth_email_delivery_attempts" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "source_event_id" UUID NOT NULL,
  "event_type" VARCHAR(160) NOT NULL,
  "source_event_hash" BYTEA NOT NULL,
  "status" "AuthEmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lease_owner" VARCHAR(100),
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "retry_at" TIMESTAMPTZ(6),
  "provider_message_id" VARCHAR(255),
  "last_error_code" VARCHAR(64),
  "smtp_accepted_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "auth_email_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_email_delivery_attempts_event_type_check" CHECK (
    "event_type" IN (
      'identity.email-verification.requested.v1',
      'identity.password-reset.requested.v1',
      'workspace.invite.requested.v1'
    )
  ),
  CONSTRAINT "auth_email_delivery_attempts_hash_check" CHECK (
    octet_length("source_event_hash") = 32
  ),
  CONSTRAINT "auth_email_delivery_attempts_attempts_check" CHECK (
    "attempts" BETWEEN 0 AND 20
  ),
  CONSTRAINT "auth_email_delivery_attempts_version_check" CHECK (
    "version" > 0
  ),
  CONSTRAINT "auth_email_delivery_attempts_error_code_check" CHECK (
    "last_error_code" IS NULL
    OR "last_error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  CONSTRAINT "auth_email_delivery_attempts_provider_receipt_check" CHECK (
    ("provider_message_id" IS NULL) = ("smtp_accepted_at" IS NULL)
  ),
  CONSTRAINT "auth_email_delivery_attempts_lease_tuple_check" CHECK (
    (("lease_owner" IS NULL)::INTEGER +
      ("lease_token" IS NULL)::INTEGER +
      ("lease_expires_at" IS NULL)::INTEGER) IN (0, 3)
  ),
  CONSTRAINT "auth_email_delivery_attempts_state_check" CHECK (
    CASE "status"
      WHEN 'PENDING' THEN
        "lease_token" IS NULL AND "retry_at" IS NULL
      WHEN 'SENDING' THEN
        "lease_token" IS NOT NULL AND "retry_at" IS NULL
      WHEN 'RETRY_SCHEDULED' THEN
        "lease_token" IS NULL AND "retry_at" IS NOT NULL
      WHEN 'SMTP_ACCEPTED' THEN
        "lease_token" IS NOT NULL
        AND "retry_at" IS NULL
        AND "provider_message_id" IS NOT NULL
      WHEN 'DLQ_PENDING' THEN
        (
          ("lease_token" IS NOT NULL AND "retry_at" IS NULL)
          OR ("lease_token" IS NULL AND "retry_at" IS NOT NULL)
        )
      WHEN 'COMPLETED' THEN
        "lease_token" IS NULL
        AND "retry_at" IS NULL
        AND "provider_message_id" IS NOT NULL
        AND "completed_at" IS NOT NULL
        AND "cancelled_at" IS NULL
        AND "failed_at" IS NULL
      WHEN 'CANCELLED' THEN
        "lease_token" IS NULL
        AND "retry_at" IS NULL
        AND "provider_message_id" IS NULL
        AND "completed_at" IS NULL
        AND "cancelled_at" IS NOT NULL
        AND "failed_at" IS NULL
      WHEN 'FAILED_FINAL' THEN
        "lease_token" IS NULL
        AND "retry_at" IS NULL
        AND "completed_at" IS NULL
        AND "cancelled_at" IS NULL
        AND "failed_at" IS NOT NULL
      ELSE FALSE
    END
  )
);

CREATE UNIQUE INDEX
  "auth_email_delivery_attempts_source_event_id_key"
  ON "auth_email_delivery_attempts"("source_event_id");

CREATE INDEX "auth_email_delivery_attempts_dispatch_idx"
  ON "auth_email_delivery_attempts"(
    "status",
    "retry_at",
    "lease_expires_at",
    "created_at"
  );

CREATE FUNCTION public.guard_auth_email_delivery_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW."source_event_id" <> OLD."source_event_id"
    OR NEW."event_type" <> OLD."event_type"
    OR NEW."source_event_hash" <> OLD."source_event_hash"
    OR NEW."created_at" <> OLD."created_at"
  THEN
    RAISE EXCEPTION
      'auth email delivery source identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."attempts" < OLD."attempts"
    OR NEW."attempts" > OLD."attempts" + 1
    OR NEW."version" <> OLD."version" + 1
  THEN
    RAISE EXCEPTION
      'auth email delivery counters must advance monotonically'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" IN ('COMPLETED', 'CANCELLED', 'FAILED_FINAL')
  THEN
    RAISE EXCEPTION
      'auth email terminal delivery is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" = 'SENDING')
    OR (
      OLD."status" = 'SENDING'
      AND NEW."status" IN (
        'SENDING',
        'RETRY_SCHEDULED',
        'SMTP_ACCEPTED',
        'DLQ_PENDING',
        'CANCELLED',
        'FAILED_FINAL'
      )
    )
    OR (
      OLD."status" = 'RETRY_SCHEDULED'
      AND NEW."status" IN ('SENDING', 'SMTP_ACCEPTED', 'DLQ_PENDING')
    )
    OR (
      OLD."status" = 'SMTP_ACCEPTED'
      AND NEW."status" IN (
        'SMTP_ACCEPTED',
        'RETRY_SCHEDULED',
        'DLQ_PENDING',
        'COMPLETED',
        'FAILED_FINAL'
      )
    )
    OR (
      OLD."status" = 'DLQ_PENDING'
      AND NEW."status" IN ('DLQ_PENDING', 'FAILED_FINAL')
    )
  )
  THEN
    RAISE EXCEPTION
      'illegal auth email delivery transition'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."attempts" = OLD."attempts" + 1
    AND (
      NEW."status" NOT IN ('SENDING', 'SMTP_ACCEPTED')
      OR NEW."lease_token" IS NULL
    )
  THEN
    RAISE EXCEPTION
      'auth email attempt increment requires a claimed delivery state'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."provider_message_id" IS NOT NULL
    AND (
      NEW."provider_message_id" IS DISTINCT FROM OLD."provider_message_id"
      OR NEW."smtp_accepted_at" IS DISTINCT FROM OLD."smtp_accepted_at"
    )
  THEN
    RAISE EXCEPTION
      'auth email SMTP receipt is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "auth_email_delivery_attempts_guard"
  BEFORE UPDATE ON "auth_email_delivery_attempts"
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_auth_email_delivery_attempt();

REVOKE ALL ON FUNCTION public.guard_auth_email_delivery_attempt()
  FROM PUBLIC;

COMMIT;
