BEGIN;

CREATE TABLE "rank_execution_quota_reservations" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "job_item_id" UUID NOT NULL,
  "execution_attempt" INTEGER NOT NULL,
  "meter" VARCHAR(64) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "policy_version" VARCHAR(64) NOT NULL,
  "window_started_at" TIMESTAMPTZ(6) NOT NULL,
  "window_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_execution_quota_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rank_quota_reservations_shape_check"
    CHECK (
      "execution_attempt" BETWEEN 1 AND 1000
      AND "meter" = 'RANK_PROVIDER_TASK'
      AND "quantity" = 1
      AND "policy_version" =
        'manual-arsenkin-positions@1.0.0'
      AND "window_started_at" =
        date_trunc('day', "window_started_at" AT TIME ZONE 'UTC')
          AT TIME ZONE 'UTC'
      AND "window_ends_at" = "window_started_at" + INTERVAL '1 day'
      AND "created_at" >= "window_started_at"
      AND "created_at" < "window_ends_at"
    )
);

CREATE UNIQUE INDEX "rank_quota_reservations_item_attempt_key"
  ON "rank_execution_quota_reservations" (
    "workspace_id",
    "job_item_id",
    "execution_attempt"
  );

CREATE UNIQUE INDEX "rank_quota_reservations_receipt_binding_key"
  ON "rank_execution_quota_reservations" (
    "id",
    "workspace_id",
    "project_id",
    "actor_id",
    "job_id",
    "job_item_id",
    "execution_attempt",
    "policy_version"
  );

CREATE INDEX "rank_quota_reservations_window_idx"
  ON "rank_execution_quota_reservations" (
    "workspace_id",
    "meter",
    "window_started_at",
    "created_at"
  );

CREATE INDEX "rank_quota_reservations_project_idx"
  ON "rank_execution_quota_reservations" (
    "workspace_id",
    "project_id",
    "created_at"
  );

ALTER TABLE "rank_execution_grant_receipts"
  ADD CONSTRAINT "rank_execution_grants_quota_reservation_fkey"
  FOREIGN KEY (
    "quota_reservation_id",
    "workspace_id",
    "project_id",
    "actor_id",
    "job_id",
    "job_item_id",
    "execution_attempt",
    "policy_version"
  )
  REFERENCES "rank_execution_quota_reservations" (
    "id",
    "workspace_id",
    "project_id",
    "actor_id",
    "job_id",
    "job_item_id",
    "execution_attempt",
    "policy_version"
  )
  ON DELETE RESTRICT
  ON UPDATE RESTRICT;

CREATE FUNCTION "protect_rank_execution_quota_reservation"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Rank execution quota reservations are immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_execution_quota_reservation_immutable"
  BEFORE UPDATE OR DELETE ON "rank_execution_quota_reservations"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_rank_execution_quota_reservation"();

CREATE TRIGGER "rank_execution_quota_reservation_no_truncate"
  BEFORE TRUNCATE ON "rank_execution_quota_reservations"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "protect_rank_execution_quota_reservation"();

REVOKE ALL ON FUNCTION
  "protect_rank_execution_quota_reservation"()
  FROM PUBLIC;

COMMIT;
