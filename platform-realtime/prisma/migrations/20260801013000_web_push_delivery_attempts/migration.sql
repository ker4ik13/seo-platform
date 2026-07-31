ALTER TABLE "notifications"
  ADD COLUMN "in_app_visible" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "web_push_encryption_key_canaries" (
  "key_version" INTEGER NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "nonce" BYTEA NOT NULL,
  "auth_tag" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "web_push_encryption_key_canaries_pkey" PRIMARY KEY ("key_version"),
  CONSTRAINT "web_push_encryption_key_canaries_shape_check" CHECK (
    "key_version" > 0
    AND octet_length("ciphertext") BETWEEN 1 AND 256
    AND octet_length("nonce") = 12
    AND octet_length("auth_tag") = 16
  )
);

CREATE TABLE "web_push_fingerprint_key_canaries" (
  "key_version" INTEGER NOT NULL,
  "digest" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "web_push_fingerprint_key_canaries_pkey" PRIMARY KEY ("key_version"),
  CONSTRAINT "web_push_fingerprint_key_canaries_shape_check" CHECK (
    "key_version" > 0 AND octet_length("digest") = 32
  )
);

CREATE UNIQUE INDEX "notifications_id_user_key"
  ON "notifications"("id", "user_id");

CREATE UNIQUE INDEX "web_push_subscriptions_id_user_key"
  ON "web_push_subscriptions"("id", "user_id");

CREATE TYPE "WebPushDeliveryAttemptStatus" AS ENUM (
  'PENDING',
  'CLAIMED',
  'RETRY_SCHEDULED',
  'DELIVERED',
  'FAILED_FINAL',
  'CANCELLED'
);

CREATE TABLE "web_push_delivery_attempts" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "notification_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "subscription_version" INTEGER NOT NULL,
  "status" "WebPushDeliveryAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "delivery_mode" "NotificationDeliveryMode" NOT NULL,
  "policy_snapshot" JSONB NOT NULL,
  "payload_snapshot" JSONB NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 8,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "last_http_status" INTEGER,
  "last_error_code" VARCHAR(64),
  "provider_message_id" VARCHAR(255),
  "delivered_at" TIMESTAMPTZ(6),
  "terminal_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "web_push_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "web_push_delivery_attempts_notification_user_fkey"
    FOREIGN KEY ("notification_id", "user_id")
    REFERENCES "notifications"("id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "web_push_delivery_attempts_subscription_user_fkey"
    FOREIGN KEY ("subscription_id", "user_id")
    REFERENCES "web_push_subscriptions"("id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "web_push_delivery_attempts_counts_check"
    CHECK (
      "subscription_version" > 0
      AND "attempt_count" >= 0
      AND "max_attempts" BETWEEN 1 AND 100
      AND "attempt_count" <= "max_attempts"
    ),
  CONSTRAINT "web_push_delivery_attempts_http_status_check"
    CHECK (
      "last_http_status" IS NULL
      OR "last_http_status" BETWEEN 100 AND 599
    ),
  CONSTRAINT "web_push_delivery_attempts_snapshot_check"
    CHECK (
      jsonb_typeof("policy_snapshot") = 'object'
      AND octet_length("policy_snapshot"::text) <= 8192
      AND jsonb_typeof("payload_snapshot") = 'object'
      AND octet_length("payload_snapshot"::text) <= 4096
    ),
  CONSTRAINT "web_push_delivery_attempts_state_check"
    CHECK (
      (
        "status" IN ('PENDING', 'RETRY_SCHEDULED')
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "terminal_at" IS NULL
        AND "delivered_at" IS NULL
      )
      OR (
        "status" = 'CLAIMED'
        AND "attempt_count" > 0
        AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "terminal_at" IS NULL
        AND "delivered_at" IS NULL
      )
      OR (
        "status" = 'DELIVERED'
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "terminal_at" IS NOT NULL
        AND "delivered_at" IS NOT NULL
        AND "last_error_code" IS NULL
      )
      OR (
        "status" IN ('FAILED_FINAL', 'CANCELLED')
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "terminal_at" IS NOT NULL
        AND "delivered_at" IS NULL
        AND "last_error_code" IS NOT NULL
      )
    )
  )
);

CREATE UNIQUE INDEX "web_push_delivery_notification_subscription_key"
  ON "web_push_delivery_attempts"("notification_id", "subscription_id");

CREATE INDEX "web_push_delivery_claim_idx"
  ON "web_push_delivery_attempts"(
    "status",
    "available_at",
    "lease_expires_at",
    "id"
  );

CREATE INDEX "web_push_delivery_user_history_idx"
  ON "web_push_delivery_attempts"(
    "user_id",
    "created_at" DESC,
    "id" DESC
  );

CREATE INDEX "web_push_delivery_subscription_status_idx"
  ON "web_push_delivery_attempts"(
    "subscription_id",
    "status",
    "created_at" DESC
  );
