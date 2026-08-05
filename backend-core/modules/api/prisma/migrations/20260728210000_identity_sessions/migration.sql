-- CreateEnum
CREATE TYPE "OneTimeTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS', 'PRIVACY', 'MARKETING');

-- AlterTable
ALTER TABLE "sessions"
ADD COLUMN "csrf_token_hash" TEXT NOT NULL DEFAULT 'invalidated-by-migration',
ADD COLUMN "replaced_by_session_id" UUID,
ADD COLUMN "authenticated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "sessions"
SET "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP);

ALTER TABLE "sessions"
ALTER COLUMN "csrf_token_hash" DROP DEFAULT;

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "purpose" "OneTimeTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "document_version" VARCHAR(64) NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_family_id_revoked_at_idx"
ON "sessions"("family_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_tokens_token_hash_key"
ON "one_time_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "one_time_tokens_user_id_purpose_consumed_at_idx"
ON "one_time_tokens"("user_id", "purpose", "consumed_at");

-- CreateIndex
CREATE INDEX "one_time_tokens_expires_at_idx"
ON "one_time_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "user_consents_user_id_type_created_at_idx"
ON "user_consents"("user_id", "type", "created_at");

-- AddForeignKey
ALTER TABLE "one_time_tokens"
ADD CONSTRAINT "one_time_tokens_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents"
ADD CONSTRAINT "user_consents_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
