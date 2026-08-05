CREATE TYPE "WebPushSubscriptionStatus" AS ENUM (
  'ACTIVE',
  'REVOKED',
  'EXPIRED'
);

CREATE TYPE "WebPushSubscriptionStatusReason" AS ENUM (
  'USER_REVOKED',
  'SESSION_REVOKED',
  'PERMISSION_REVOKED',
  'PUSH_SERVICE_GONE',
  'ACCOUNT_CHANGED'
);

CREATE TYPE "WebPushDeliveryStatus" AS ENUM (
  'NEVER',
  'DELIVERED',
  'FAILED'
);

CREATE TABLE "web_push_subscriptions" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "user_id" UUID NOT NULL,
  "installation_id" UUID NOT NULL,
  "registered_session_family_id" UUID NOT NULL,
  "status" "WebPushSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "status_reason" "WebPushSubscriptionStatusReason",
  "endpoint_fingerprint" BYTEA,
  "material_fingerprint" BYTEA,
  "material_ciphertext" BYTEA,
  "material_nonce" BYTEA,
  "material_auth_tag" BYTEA,
  "encryption_key_version" INTEGER,
  "fingerprint_key_version" INTEGER,
  "application_server_key_version" INTEGER NOT NULL,
  "label" VARCHAR(80) NOT NULL,
  "browser" VARCHAR(32) NOT NULL,
  "platform" VARCHAR(32) NOT NULL,
  "provider_expires_at" TIMESTAMPTZ(6),
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_delivery_status" "WebPushDeliveryStatus" NOT NULL DEFAULT 'NEVER',
  "last_delivery_at" TIMESTAMPTZ(6),
  "last_delivery_error_code" VARCHAR(64),
  "revoked_at" TIMESTAMPTZ(6),
  "expired_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "web_push_subscriptions_versions_check"
    CHECK (
      "version" > 0
      AND "application_server_key_version" > 0
      AND (
        "encryption_key_version" IS NULL
        OR "encryption_key_version" > 0
      )
      AND (
        "fingerprint_key_version" IS NULL
        OR "fingerprint_key_version" > 0
      )
    ),
  CONSTRAINT "web_push_subscriptions_label_check"
    CHECK (
      char_length("label") BETWEEN 1 AND 80
      AND "label" !~ '[[:cntrl:]]'
    ),
  CONSTRAINT "web_push_subscriptions_crypto_check"
    CHECK (
      (
        "status" = 'ACTIVE'
        AND "status_reason" IS NULL
        AND "endpoint_fingerprint" IS NOT NULL
        AND octet_length("endpoint_fingerprint") = 32
        AND "material_fingerprint" IS NOT NULL
        AND octet_length("material_fingerprint") = 32
        AND "material_ciphertext" IS NOT NULL
        AND octet_length("material_ciphertext") > 0
        AND "material_nonce" IS NOT NULL
        AND octet_length("material_nonce") = 12
        AND "material_auth_tag" IS NOT NULL
        AND octet_length("material_auth_tag") = 16
        AND "encryption_key_version" IS NOT NULL
        AND "fingerprint_key_version" IS NOT NULL
        AND "revoked_at" IS NULL
        AND "expired_at" IS NULL
      )
      OR (
        "status" = 'REVOKED'
        AND "status_reason" IS NOT NULL
        AND "endpoint_fingerprint" IS NULL
        AND "material_fingerprint" IS NULL
        AND "material_ciphertext" IS NULL
        AND "material_nonce" IS NULL
        AND "material_auth_tag" IS NULL
        AND "encryption_key_version" IS NULL
        AND "fingerprint_key_version" IS NULL
        AND "revoked_at" IS NOT NULL
        AND "expired_at" IS NULL
      )
      OR (
        "status" = 'EXPIRED'
        AND "status_reason" IS NOT NULL
        AND "endpoint_fingerprint" IS NULL
        AND "material_fingerprint" IS NULL
        AND "material_ciphertext" IS NULL
        AND "material_nonce" IS NULL
        AND "material_auth_tag" IS NULL
        AND "encryption_key_version" IS NULL
        AND "fingerprint_key_version" IS NULL
        AND "revoked_at" IS NULL
        AND "expired_at" IS NOT NULL
      )
    ),
  CONSTRAINT "web_push_subscriptions_delivery_check"
    CHECK (
      (
        "last_delivery_status" = 'NEVER'
        AND "last_delivery_at" IS NULL
        AND "last_delivery_error_code" IS NULL
      )
      OR (
        "last_delivery_status" = 'DELIVERED'
        AND "last_delivery_at" IS NOT NULL
        AND "last_delivery_error_code" IS NULL
      )
      OR (
        "last_delivery_status" = 'FAILED'
        AND "last_delivery_at" IS NOT NULL
        AND "last_delivery_error_code" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "web_push_subscriptions_user_installation_key"
  ON "web_push_subscriptions"("user_id", "installation_id");

CREATE UNIQUE INDEX "web_push_subscriptions_active_endpoint_key"
  ON "web_push_subscriptions"("endpoint_fingerprint")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "web_push_subscriptions_user_status_updated_idx"
  ON "web_push_subscriptions"(
    "user_id",
    "status",
    "updated_at" DESC,
    "id" DESC
  );

CREATE INDEX "web_push_subscriptions_status_expiry_idx"
  ON "web_push_subscriptions"("status", "provider_expires_at");
