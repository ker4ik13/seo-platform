CREATE TYPE "MfaMethodType" AS ENUM ('TOTP');
CREATE TYPE "MfaMethodStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

CREATE TABLE "mfa_methods" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "user_id" UUID NOT NULL,
  "type" "MfaMethodType" NOT NULL,
  "status" "MfaMethodStatus" NOT NULL DEFAULT 'PENDING',
  "secret_encrypted" TEXT NOT NULL,
  "last_used_counter" BIGINT,
  "confirmed_at" TIMESTAMPTZ(6),
  "last_used_at" TIMESTAMPTZ(6),
  "disabled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "mfa_methods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_methods_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mfa_methods_one_active_totp_per_user"
  ON "mfa_methods" ("user_id", "type")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "mfa_methods_user_id_type_status_idx"
  ON "mfa_methods" ("user_id", "type", "status");

CREATE TABLE "recovery_codes" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "user_id" UUID NOT NULL,
  "code_hash" CHAR(64) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recovery_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "recovery_codes_user_id_code_hash_key"
  ON "recovery_codes" ("user_id", "code_hash");
CREATE INDEX "recovery_codes_user_id_used_at_idx"
  ON "recovery_codes" ("user_id", "used_at");

CREATE TABLE "mfa_challenges" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "ip_address" INET,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_challenges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mfa_challenges_token_hash_key"
  ON "mfa_challenges" ("token_hash");
CREATE INDEX "mfa_challenges_user_id_consumed_at_expires_at_idx"
  ON "mfa_challenges" ("user_id", "consumed_at", "expires_at");
CREATE INDEX "mfa_challenges_expires_at_idx"
  ON "mfa_challenges" ("expires_at");
