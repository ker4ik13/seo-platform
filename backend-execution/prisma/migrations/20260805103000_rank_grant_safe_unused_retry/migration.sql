-- A consumed grant normally remains terminal and cannot be replayed. The only
-- safe exception is an authorization whose connector execution expired before
-- any provider request bytes or provider task identity existed. Preserve both
-- immutable history rows and permit a new numbered authorization attempt.
CREATE OR REPLACE FUNCTION "protect_rank_execution_grant_attempt"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Rank execution grant attempts are immutable history'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW."status" <> 'REQUESTED'
    OR NEW."decision_snapshot" IS NOT NULL
    OR NEW."decided_at" IS NOT NULL
    OR NEW."expires_at" IS NOT NULL
    OR NEW."terminal_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Rank execution grant attempt must start in exact REQUESTED state'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND (
    (
      NEW."execution_attempt" = 1
      AND EXISTS (
        SELECT 1
        FROM "rank_execution_grant_attempts" prior
        WHERE prior."workspace_id" = NEW."workspace_id"
          AND prior."job_item_id" = NEW."job_item_id"
      )
    )
    OR
    (
      NEW."execution_attempt" > 1
      AND NOT EXISTS (
        SELECT 1
        FROM "rank_execution_grant_attempts" prior
        WHERE prior."workspace_id" = NEW."workspace_id"
          AND prior."job_item_id" = NEW."job_item_id"
          AND prior."execution_attempt" = NEW."execution_attempt" - 1
          AND (
            prior."status" = 'EXPIRED'
            OR (
              prior."status" = 'CONSUMED'
              AND EXISTS (
                SELECT 1
                FROM "rank_connector_executions" execution
                WHERE execution."grant_attempt_id" = prior."id"
                  AND execution."workspace_id" = prior."workspace_id"
                  AND execution."job_item_id" = prior."job_item_id"
                  AND execution."status" IN ('READY_TO_SUBMIT', 'CLAIMED')
                  AND execution."authorization_expires_at" <= clock_timestamp()
                  AND execution."submit_attempt_count" = 0
                  AND execution."submit_bytes_started_at" IS NULL
                  AND execution."provider_task_id" IS NULL
              )
            )
          )
      )
    )
    OR EXISTS (
      SELECT 1
      FROM "rank_execution_grant_attempts" existing
      WHERE existing."workspace_id" = NEW."workspace_id"
        AND existing."job_item_id" = NEW."job_item_id"
        AND existing."execution_attempt" >= NEW."execution_attempt"
    )
  ) THEN
    RAISE EXCEPTION
      'Rank execution grant attempts require one safely retryable predecessor'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
    OR NEW."project_id" IS DISTINCT FROM OLD."project_id"
    OR NEW."job_id" IS DISTINCT FROM OLD."job_id"
    OR NEW."job_item_id" IS DISTINCT FROM OLD."job_item_id"
    OR NEW."execution_attempt" IS DISTINCT FROM OLD."execution_attempt"
    OR NEW."job_version" IS DISTINCT FROM OLD."job_version"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_snapshot" IS DISTINCT FROM OLD."request_snapshot"
    OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
    OR NEW."scope_hash" IS DISTINCT FROM OLD."scope_hash"
    OR NEW."execution_evidence_hash"
      IS DISTINCT FROM OLD."execution_evidence_hash"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."updated_at" < OLD."updated_at"
  ) THEN
    RAISE EXCEPTION 'Rank execution grant request identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" IN (
      'DENIED',
      'EXPIRED',
      'CONSUMED',
      'REJECTED_LOCAL'
    )
  THEN
    RAISE EXCEPTION 'Terminal rank execution grant attempt is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND NOT (
    (
      OLD."status" = 'REQUESTED'
      AND NEW."status" IN (
        'DENIED',
        'GRANTED_PENDING_CONSUME',
        'EXPIRED',
        'REJECTED_LOCAL'
      )
    )
    OR
    (
      OLD."status" = 'GRANTED_PENDING_CONSUME'
      AND NEW."status" IN ('CONSUMED', 'EXPIRED', 'REJECTED_LOCAL')
    )
  ) THEN
    RAISE EXCEPTION 'Invalid rank execution grant attempt transition'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" = 'GRANTED_PENDING_CONSUME'
    AND (
      NEW."decision_snapshot" IS DISTINCT FROM OLD."decision_snapshot"
      OR NEW."decided_at" IS DISTINCT FROM OLD."decided_at"
      OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
    )
  THEN
    RAISE EXCEPTION 'Granted rank execution decision is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;
