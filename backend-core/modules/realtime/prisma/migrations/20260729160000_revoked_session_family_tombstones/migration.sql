BEGIN;

ALTER TABLE "inbox_events"
  ADD COLUMN "scope_key" VARCHAR(180);

CREATE TABLE "revoked_session_family_tombstones" (
  "user_id" UUID NOT NULL,
  "session_family_id" UUID NOT NULL,
  "source_event_id" UUID NOT NULL,
  "revoked_at" TIMESTAMPTZ(6) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "revoked_session_family_tombstones_pkey"
    PRIMARY KEY ("user_id", "session_family_id"),
  CONSTRAINT "revoked_session_family_tombstones_source_event_key"
    UNIQUE ("source_event_id"),
  CONSTRAINT "revoked_session_family_tombstones_timestamps_check"
    CHECK (
      isfinite("revoked_at")
      AND isfinite("received_at")
      AND "revoked_at" <= "received_at" + INTERVAL '5 minutes'
    )
);

CREATE INDEX "revoked_session_family_tombstones_retention_idx"
  ON "revoked_session_family_tombstones"(
    "received_at",
    "user_id",
    "session_family_id"
  );

CREATE INDEX "web_push_subscriptions_user_family_status_idx"
  ON "web_push_subscriptions"(
    "user_id",
    "registered_session_family_id",
    "status"
  );

COMMIT;
