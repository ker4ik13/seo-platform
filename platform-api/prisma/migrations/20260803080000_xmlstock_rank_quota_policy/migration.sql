BEGIN;

LOCK TABLE "rank_execution_quota_reservations" IN ACCESS EXCLUSIVE MODE;

-- Immutable Arsenkin receipts remain valid. XMLStock position checks use the
-- same provider-task meter and must be reservable before connector submission.
ALTER TABLE "rank_execution_quota_reservations"
  DROP CONSTRAINT "rank_quota_reservations_shape_check";

ALTER TABLE "rank_execution_quota_reservations"
  ADD CONSTRAINT "rank_quota_reservations_shape_check"
    CHECK (
      "execution_attempt" BETWEEN 1 AND 1000
      AND "meter" = 'RANK_PROVIDER_TASK'
      AND "quantity" = 1
      AND "policy_version" IN (
        'manual-arsenkin-positions@1.0.0',
        'manual-arsenkin-positions@2.0.0',
        'manual-xmlstock-serp@1.0.0'
      )
      AND "window_started_at" =
        date_trunc('day', "window_started_at" AT TIME ZONE 'UTC')
          AT TIME ZONE 'UTC'
      AND "window_ends_at" = "window_started_at" + INTERVAL '1 day'
      AND "created_at" >= "window_started_at"
      AND "created_at" < "window_ends_at"
    ) NOT VALID;

ALTER TABLE "rank_execution_quota_reservations"
  VALIDATE CONSTRAINT "rank_quota_reservations_shape_check";

COMMIT;
