BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "integration_credentials") THEN
    RAISE EXCEPTION
      'integration credential vault migration requires an empty pre-release table';
  END IF;
END
$$;

ALTER TABLE "integration_credentials"
  ALTER COLUMN "status" SET DEFAULT 'PENDING_VERIFICATION',
  ADD COLUMN "encrypted_data_key" BYTEA NOT NULL,
  ADD COLUMN "data_key_nonce" BYTEA NOT NULL,
  ADD COLUMN "data_key_auth_tag" BYTEA NOT NULL,
  ADD COLUMN "idempotency_key" VARCHAR(255) NOT NULL,
  ADD COLUMN "request_fingerprint" BYTEA NOT NULL,
  ADD COLUMN "fingerprint_key_version" INTEGER NOT NULL,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID;

ALTER TABLE "integration_credentials"
  ADD CONSTRAINT "integration_credentials_ciphertext_not_empty"
    CHECK (octet_length("ciphertext") > 0),
  ADD CONSTRAINT "integration_credentials_nonce_length"
    CHECK (octet_length("nonce") = 12),
  ADD CONSTRAINT "integration_credentials_auth_tag_length"
    CHECK (octet_length("auth_tag") = 16),
  ADD CONSTRAINT "integration_credentials_encrypted_data_key_not_empty"
    CHECK (octet_length("encrypted_data_key") > 0),
  ADD CONSTRAINT "integration_credentials_data_key_nonce_length"
    CHECK (octet_length("data_key_nonce") = 12),
  ADD CONSTRAINT "integration_credentials_data_key_auth_tag_length"
    CHECK (octet_length("data_key_auth_tag") = 16),
  ADD CONSTRAINT "integration_credentials_request_fingerprint_length"
    CHECK (octet_length("request_fingerprint") = 32),
  ADD CONSTRAINT "integration_credentials_key_version_positive"
    CHECK ("key_version" > 0),
  ADD CONSTRAINT "integration_credentials_fingerprint_key_version_positive"
    CHECK ("fingerprint_key_version" > 0);

CREATE UNIQUE INDEX "integration_credentials_workspace_id_idempotency_key_key"
  ON "integration_credentials" ("workspace_id", "idempotency_key");

CREATE INDEX "integration_credentials_workspace_id_created_at_id_idx"
  ON "integration_credentials" ("workspace_id", "created_at", "id");

CREATE INDEX "integration_credentials_key_version_deleted_at_id_idx"
  ON "integration_credentials" ("key_version", "deleted_at", "id");

CREATE INDEX "integration_credentials_fingerprint_key_version_deleted_at_id_idx"
  ON "integration_credentials" ("fingerprint_key_version", "deleted_at", "id");

COMMIT;
