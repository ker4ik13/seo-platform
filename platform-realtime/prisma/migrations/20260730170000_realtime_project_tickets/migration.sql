BEGIN;

CREATE TABLE "realtime_project_tickets" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "ticket_hash" BYTEA NOT NULL,
  "origin_hash" BYTEA NOT NULL,
  "user_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "session_family_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "membership_version" INTEGER NOT NULL,
  "client_instance_id" UUID NOT NULL,
  "session_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "issued_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "authorization_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "invalidated_at" TIMESTAMPTZ(6),
  "consumed_at" TIMESTAMPTZ(6),
  "connection_id" VARCHAR(64),
  "disconnected_at" TIMESTAMPTZ(6),

  CONSTRAINT "realtime_project_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "realtime_project_tickets_ticket_hash_key"
    UNIQUE ("ticket_hash"),
  CONSTRAINT "realtime_project_tickets_hashes_check"
    CHECK (
      octet_length("ticket_hash") = 32
      AND octet_length("origin_hash") = 32
    ),
  CONSTRAINT "realtime_project_tickets_membership_version_check"
    CHECK ("membership_version" BETWEEN 1 AND 2147483647),
  CONSTRAINT "realtime_project_tickets_timestamps_check"
    CHECK (
      isfinite("session_expires_at")
      AND isfinite("issued_at")
      AND isfinite("expires_at")
      AND isfinite("authorization_expires_at")
      AND "expires_at" = "issued_at" + INTERVAL '30 seconds'
      AND "authorization_expires_at" = "issued_at" + INTERVAL '60 seconds'
      AND "session_expires_at" >= "authorization_expires_at"
      AND (
        "invalidated_at" IS NULL
        OR (
          isfinite("invalidated_at")
          AND "invalidated_at" >= "issued_at"
        )
      )
      AND (
        "consumed_at" IS NULL
        OR (
          isfinite("consumed_at")
          AND "consumed_at" >= "issued_at"
          AND "consumed_at" <= "expires_at"
        )
      )
      AND (
        "disconnected_at" IS NULL
        OR (
          isfinite("disconnected_at")
          AND "consumed_at" IS NOT NULL
          AND "disconnected_at" >= "consumed_at"
        )
      )
    ),
  CONSTRAINT "realtime_project_tickets_state_check"
    CHECK (
      (
        "invalidated_at" IS NULL
        AND "consumed_at" IS NULL
        AND "connection_id" IS NULL
        AND "disconnected_at" IS NULL
      )
      OR (
        "invalidated_at" IS NOT NULL
        AND "consumed_at" IS NULL
        AND "connection_id" IS NULL
        AND "disconnected_at" IS NULL
      )
      OR (
        "invalidated_at" IS NULL
        AND "consumed_at" IS NOT NULL
        AND "connection_id" IS NOT NULL
      )
    ),
  CONSTRAINT "realtime_project_tickets_connection_id_check"
    CHECK (
      "connection_id" IS NULL
      OR "connection_id" ~ '^[A-Za-z0-9_-]{1,64}$'
    )
);

CREATE UNIQUE INDEX "realtime_project_tickets_active_scope_key"
  ON "realtime_project_tickets"(
    "user_id",
    "session_id",
    "project_id",
    "client_instance_id"
  )
  WHERE "consumed_at" IS NULL AND "invalidated_at" IS NULL;

CREATE UNIQUE INDEX "realtime_project_tickets_connection_key"
  ON "realtime_project_tickets"("connection_id")
  WHERE "connection_id" IS NOT NULL;

CREATE INDEX "realtime_project_tickets_user_issued_idx"
  ON "realtime_project_tickets"("user_id", "issued_at" DESC);

CREATE INDEX "realtime_project_tickets_active_user_lease_idx"
  ON "realtime_project_tickets"("user_id", "authorization_expires_at")
  WHERE "consumed_at" IS NOT NULL AND "disconnected_at" IS NULL;

CREATE INDEX "realtime_project_tickets_family_lease_idx"
  ON "realtime_project_tickets"(
    "user_id",
    "session_family_id",
    "authorization_expires_at"
  );

CREATE INDEX "realtime_project_tickets_retention_idx"
  ON "realtime_project_tickets"("authorization_expires_at", "id");

CREATE FUNCTION "realtime_project_ticket_scope_immutable"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW."ticket_hash" IS DISTINCT FROM OLD."ticket_hash"
    OR NEW."origin_hash" IS DISTINCT FROM OLD."origin_hash"
    OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
    OR NEW."session_id" IS DISTINCT FROM OLD."session_id"
    OR NEW."session_family_id" IS DISTINCT FROM OLD."session_family_id"
    OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
    OR NEW."project_id" IS DISTINCT FROM OLD."project_id"
    OR NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
    OR NEW."membership_version" IS DISTINCT FROM OLD."membership_version"
    OR NEW."client_instance_id" IS DISTINCT FROM OLD."client_instance_id"
    OR NEW."session_expires_at" IS DISTINCT FROM OLD."session_expires_at"
    OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
    OR NEW."authorization_expires_at" IS DISTINCT FROM OLD."authorization_expires_at"
  ) THEN
    RAISE EXCEPTION 'realtime project ticket authorization scope is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "realtime_project_ticket_scope_immutable"
BEFORE UPDATE ON "realtime_project_tickets"
FOR EACH ROW
EXECUTE FUNCTION "realtime_project_ticket_scope_immutable"();

COMMIT;
