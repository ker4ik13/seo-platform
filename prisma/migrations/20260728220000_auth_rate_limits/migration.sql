CREATE TABLE "auth_rate_limit_buckets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "action" VARCHAR(32) NOT NULL,
    "subject_hash" CHAR(64) NOT NULL,
    "window_started_at" TIMESTAMPTZ(6) NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 1,
    "blocked_until" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_rate_limit_buckets_action_subject_hash_key"
ON "auth_rate_limit_buckets"("action", "subject_hash");

CREATE INDEX "auth_rate_limit_buckets_blocked_until_idx"
ON "auth_rate_limit_buckets"("blocked_until");

ALTER TABLE "sessions"
ADD COLUMN "access_token_hash" TEXT NOT NULL DEFAULT 'invalidated-by-migration',
ADD COLUMN "access_expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "sessions"
SET "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP);

ALTER TABLE "sessions"
ALTER COLUMN "access_token_hash" DROP DEFAULT,
ALTER COLUMN "access_expires_at" DROP DEFAULT;

CREATE UNIQUE INDEX "sessions_access_token_hash_key"
ON "sessions"("access_token_hash");
