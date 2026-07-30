BEGIN;

CREATE TYPE "RankExecutionGrantAttemptStatus" AS ENUM (
  'REQUESTED',
  'DENIED',
  'GRANTED_PENDING_CONSUME',
  'EXPIRED',
  'CONSUMED',
  'REJECTED_LOCAL'
);

-- Keep the legacy JobItem hardening check and constraint installation inside
-- one transaction without a concurrent writer window.
LOCK TABLE "jobs" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "job_items" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "job_items" item
    LEFT JOIN "jobs" job
      ON job."id" = item."job_id"
    WHERE job."id" IS NULL
      OR item."workspace_id" IS DISTINCT FROM job."workspace_id"
      OR item."project_id" IS DISTINCT FROM job."project_id"
  ) THEN
    RAISE EXCEPTION
      'Repair JobItem tenant scope before rank grant attempt migration'
      USING ERRCODE = '23503';
  END IF;
END
$$;

CREATE UNIQUE INDEX "jobs_tenant_id_key"
  ON "jobs" ("workspace_id", "id");

CREATE UNIQUE INDEX "job_items_tenant_job_id_key"
  ON "job_items" ("workspace_id", "project_id", "job_id", "id");

ALTER TABLE "job_items"
  DROP CONSTRAINT "job_items_job_id_fkey",
  ADD CONSTRAINT "job_items_job_tenant_fkey"
    FOREIGN KEY ("workspace_id", "job_id")
    REFERENCES "jobs" ("workspace_id", "id")
    ON DELETE CASCADE
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "job_items_job_tenant_project_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES "jobs" ("workspace_id", "project_id", "id")
    ON DELETE CASCADE
    ON UPDATE RESTRICT;

CREATE FUNCTION "assert_job_item_tenant_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "jobs" job
    WHERE job."id" = NEW."job_id"
      AND job."workspace_id" = NEW."workspace_id"
      AND job."project_id" IS NOT DISTINCT FROM NEW."project_id"
  ) THEN
    RAISE EXCEPTION 'JobItem tenant scope must equal its parent Job scope'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "job_item_tenant_scope_guard"
  BEFORE INSERT OR UPDATE OF "workspace_id", "project_id", "job_id"
  ON "job_items"
  FOR EACH ROW
  EXECUTE FUNCTION "assert_job_item_tenant_scope"();

CREATE FUNCTION "rank_execution_grant_request_is_exact"(
  p_snapshot JSONB,
  p_workspace_id UUID,
  p_project_id UUID,
  p_job_id UUID,
  p_job_item_id UUID,
  p_job_version INTEGER,
  p_execution_attempt INTEGER,
  p_execution_evidence_hash BYTEA
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  membership_id TEXT;
  membership_version INTEGER;
  project_version INTEGER;
  manifest_id TEXT;
  manifest_chunk_index INTEGER;
BEGIN
  IF jsonb_typeof(p_snapshot) <> 'object'
    OR octet_length(p_snapshot::text) > 32768
  THEN
    RETURN FALSE;
  END IF;

  membership_id := p_snapshot #>> '{membership,id}';
  membership_version := (p_snapshot #>> '{membership,version}')::integer;
  project_version := (p_snapshot #>> '{project,version}')::integer;
  manifest_id := p_snapshot #>> '{manifest,id}';
  manifest_chunk_index :=
    (p_snapshot #>> '{manifest,chunkIndex}')::integer;

  RETURN p_snapshot = jsonb_build_object(
      'schemaVersion', 'rank-execution-grant-request@1',
      'workspaceId', p_workspace_id::text,
      'projectId', p_project_id::text,
      'actorId', p_snapshot ->> 'actorId',
      'membership', jsonb_build_object(
        'id', membership_id,
        'version', membership_version
      ),
      'project', jsonb_build_object(
        'version', project_version,
        'domainHash', jsonb_build_object(
          'algorithm', 'SHA_256',
          'value', p_snapshot #>> '{project,domainHash,value}'
        )
      ),
      'jobId', p_job_id::text,
      'jobItemId', p_job_item_id::text,
      'jobVersion', p_job_version,
      'executionAttempt', p_execution_attempt,
      'purpose', 'PROVIDER_SUBMIT',
      'provider', 'ARSENKIN',
      'operation', 'POSITIONS',
      'capability', 'SERP_RANK_TRACKING',
      'credentialMode', 'BYOK_API_KEY',
      'manifest', jsonb_build_object(
        'id', manifest_id,
        'hash', jsonb_build_object(
          'algorithm', 'SHA_256',
          'value', p_snapshot #>> '{manifest,hash,value}'
        ),
        'chunkIndex', manifest_chunk_index
      ),
      'executionEvidenceHash', jsonb_build_object(
        'algorithm', 'SHA_256',
        'value', encode(p_execution_evidence_hash, 'hex')
      ),
      'policyVersion', p_snapshot ->> 'policyVersion',
      'usageIntent', jsonb_build_object(
        'meter', 'RANK_PROVIDER_TASK',
        'quantity', '1'
      )
    )
    AND (p_snapshot ->> 'actorId') =
      ((p_snapshot ->> 'actorId')::uuid)::text
    AND (p_snapshot ->> 'actorId') ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND membership_id = (membership_id::uuid)::text
    AND membership_id ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND membership_version > 0
    AND project_version > 0
    AND p_snapshot #>> '{project,domainHash,algorithm}' = 'SHA_256'
    AND (p_snapshot #>> '{project,domainHash,value}') ~
      '^[0-9a-f]{64}$'
    AND manifest_id = (manifest_id::uuid)::text
    AND manifest_id ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND p_snapshot #>> '{manifest,hash,algorithm}' = 'SHA_256'
    AND (p_snapshot #>> '{manifest,hash,value}') ~ '^[0-9a-f]{64}$'
    AND p_snapshot #>> '{executionEvidenceHash,algorithm}' = 'SHA_256'
    AND manifest_chunk_index BETWEEN 0 AND 3
    AND (p_snapshot ->> 'policyVersion') ~
      '^[a-z0-9][a-z0-9@._-]{0,63}$';
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END
$$;

CREATE FUNCTION "rank_execution_grant_decision_is_exact"(
  p_decision JSONB,
  p_expected_status TEXT,
  p_request_hash BYTEA,
  p_scope_hash BYTEA,
  p_decided_at TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  grant_snapshot JSONB;
  decided_at_text TEXT;
  issued_at_text TEXT;
  expires_at_text TEXT;
  grant_id TEXT;
BEGIN
  IF jsonb_typeof(p_decision) <> 'object'
    OR octet_length(p_decision::text) > 32768
    OR p_decided_at IS NULL
    OR p_expected_status NOT IN ('GRANTED', 'DENIED')
  THEN
    RETURN FALSE;
  END IF;

  decided_at_text := p_decision ->> 'decidedAt';

  IF decided_at_text !~
      '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    OR decided_at_text::timestamptz IS DISTINCT FROM p_decided_at
    OR p_decision #>> '{requestHash,algorithm}' <> 'SHA_256'
    OR p_decision #>> '{requestHash,value}' IS DISTINCT FROM
      encode(p_request_hash, 'hex')
  THEN
    RETURN FALSE;
  END IF;

  IF p_expected_status = 'DENIED' THEN
    RETURN p_expires_at IS NULL
      AND p_decision = jsonb_build_object(
        'schemaVersion', 'rank-execution-grant-decision@1',
        'status', 'DENIED',
        'requestHash', jsonb_build_object(
          'algorithm', 'SHA_256',
          'value', encode(p_request_hash, 'hex')
        ),
        'decidedAt', decided_at_text,
        'reason', p_decision ->> 'reason'
      )
      AND (p_decision ->> 'reason') IN (
        'WORKSPACE_NOT_ACTIVE',
        'PROJECT_NOT_ACTIVE',
        'PROJECT_VERSION_CHANGED',
        'MEMBERSHIP_NOT_ACTIVE',
        'MEMBERSHIP_VERSION_CHANGED',
        'RUN_PERMISSION_DENIED',
        'ENTITLEMENT_NOT_AVAILABLE',
        'ENTITLEMENT_DENIED',
        'QUOTA_NOT_AVAILABLE',
        'QUOTA_EXHAUSTED'
      );
  END IF;

  IF p_expires_at IS NULL THEN
    RETURN FALSE;
  END IF;

  grant_snapshot := p_decision -> 'grant';
  grant_id := grant_snapshot ->> 'id';
  issued_at_text := grant_snapshot ->> 'issuedAt';
  expires_at_text := grant_snapshot ->> 'expiresAt';

  RETURN p_decision = jsonb_build_object(
      'schemaVersion', 'rank-execution-grant-decision@1',
      'status', 'GRANTED',
      'requestHash', jsonb_build_object(
        'algorithm', 'SHA_256',
        'value', encode(p_request_hash, 'hex')
      ),
      'decidedAt', decided_at_text,
      'grant', grant_snapshot
    )
    AND grant_snapshot = jsonb_build_object(
      'schemaVersion', 'rank-execution-grant@1',
      'id', grant_id,
      'requestHash', jsonb_build_object(
        'algorithm', 'SHA_256',
        'value', encode(p_request_hash, 'hex')
      ),
      'scopeHash', jsonb_build_object(
        'algorithm', 'SHA_256',
        'value', encode(p_scope_hash, 'hex')
      ),
      'issuer', 'PLATFORM_API',
      'issuedAt', issued_at_text,
      'expiresAt', expires_at_text
    )
    AND grant_id = (grant_id::uuid)::text
    AND grant_id ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND grant_snapshot #>> '{requestHash,algorithm}' = 'SHA_256'
    AND grant_snapshot #>> '{scopeHash,algorithm}' = 'SHA_256'
    AND issued_at_text = decided_at_text
    AND expires_at_text ~
      '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    AND issued_at_text::timestamptz IS NOT DISTINCT FROM p_decided_at
    AND expires_at_text::timestamptz IS NOT DISTINCT FROM p_expires_at
    AND p_expires_at = p_decided_at + INTERVAL '30 seconds';
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END
$$;

CREATE TABLE "rank_execution_grant_attempts" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "job_item_id" UUID NOT NULL,
  "execution_attempt" INTEGER NOT NULL,
  "job_version" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_snapshot" JSONB NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "scope_hash" BYTEA NOT NULL,
  "execution_evidence_hash" BYTEA NOT NULL,
  "decision_snapshot" JSONB,
  "status" "RankExecutionGrantAttemptStatus" NOT NULL DEFAULT 'REQUESTED',
  "decided_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6),
  "terminal_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "rank_execution_grant_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rank_grant_attempts_identity"
    CHECK (
      "execution_attempt" BETWEEN 1 AND 1000
      AND "job_version" > 0
      AND "idempotency_key" ~ '^[A-Za-z0-9._:-]{16,180}$'
      AND "idempotency_key" =
        'rank-grant:' || "job_item_id"::text || ':' ||
          "execution_attempt"::text
      AND octet_length("request_hash") = 32
      AND octet_length("scope_hash") = 32
      AND octet_length("execution_evidence_hash") = 32
      AND "rank_execution_grant_request_is_exact"(
        "request_snapshot",
        "workspace_id",
        "project_id",
        "job_id",
        "job_item_id",
        "job_version",
        "execution_attempt",
        "execution_evidence_hash"
      )
    ),
  CONSTRAINT "rank_grant_attempts_state_matrix"
    CHECK (
      (
        "status" = 'REQUESTED'
        AND "decision_snapshot" IS NULL
        AND "decided_at" IS NULL
        AND "expires_at" IS NULL
        AND "terminal_at" IS NULL
      )
      OR
      (
        "status" = 'DENIED'
        AND "rank_execution_grant_decision_is_exact"(
          "decision_snapshot",
          'DENIED',
          "request_hash",
          "scope_hash",
          "decided_at",
          "expires_at"
        )
        AND "terminal_at" IS NOT NULL
        AND "terminal_at" >= "created_at"
        AND "terminal_at" >= "decided_at"
      )
      OR
      (
        "status" = 'GRANTED_PENDING_CONSUME'
        AND "rank_execution_grant_decision_is_exact"(
          "decision_snapshot",
          'GRANTED',
          "request_hash",
          "scope_hash",
          "decided_at",
          "expires_at"
        )
        AND "terminal_at" IS NULL
      )
      OR
      (
        "status" = 'CONSUMED'
        AND "rank_execution_grant_decision_is_exact"(
          "decision_snapshot",
          'GRANTED',
          "request_hash",
          "scope_hash",
          "decided_at",
          "expires_at"
        )
        AND "terminal_at" IS NOT NULL
        AND "terminal_at" >= "created_at"
        AND "terminal_at" >= "decided_at"
        AND "terminal_at" < "expires_at"
      )
      OR
      (
        "status" = 'EXPIRED'
        AND "rank_execution_grant_decision_is_exact"(
          "decision_snapshot",
          'GRANTED',
          "request_hash",
          "scope_hash",
          "decided_at",
          "expires_at"
        )
        AND "terminal_at" IS NOT NULL
        AND "terminal_at" >= "created_at"
        AND "terminal_at" >= "expires_at"
      )
      OR
      (
        "status" = 'REJECTED_LOCAL'
        AND "terminal_at" IS NOT NULL
        AND "terminal_at" >= "created_at"
        AND (
          "decided_at" IS NULL
          OR "terminal_at" >= "decided_at"
        )
        AND (
          (
            "decision_snapshot" IS NULL
            AND "decided_at" IS NULL
            AND "expires_at" IS NULL
          )
          OR
          "rank_execution_grant_decision_is_exact"(
            "decision_snapshot",
            'GRANTED',
            "request_hash",
            "scope_hash",
            "decided_at",
            "expires_at"
          )
        )
      )
    )
);

CREATE UNIQUE INDEX "rank_grant_attempts_workspace_item_attempt_key"
  ON "rank_execution_grant_attempts" (
    "workspace_id",
    "job_item_id",
    "execution_attempt"
  );

CREATE UNIQUE INDEX "rank_grant_attempts_workspace_idempotency_key"
  ON "rank_execution_grant_attempts" ("workspace_id", "idempotency_key");

CREATE INDEX "rank_grant_attempts_job_created_idx"
  ON "rank_execution_grant_attempts" (
    "workspace_id",
    "project_id",
    "job_id",
    "created_at"
  );

CREATE INDEX "rank_grant_attempts_status_expiry_idx"
  ON "rank_execution_grant_attempts" ("status", "expires_at", "created_at");

ALTER TABLE "rank_execution_grant_attempts"
  ADD CONSTRAINT "rank_grant_attempts_job_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES "jobs" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_grant_attempts_rank_run_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES "rank_job_runs" ("workspace_id", "project_id", "job_id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_grant_attempts_job_item_tenant_fkey"
    FOREIGN KEY (
      "workspace_id",
      "project_id",
      "job_id",
      "job_item_id"
    )
    REFERENCES "job_items" (
      "workspace_id",
      "project_id",
      "job_id",
      "id"
    )
    ON DELETE RESTRICT
    ON UPDATE RESTRICT;

CREATE FUNCTION "protect_rank_execution_grant_attempt"()
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
          AND prior."status" = 'EXPIRED'
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
      'Rank execution grant attempts require one expired predecessor'
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

CREATE TRIGGER "rank_execution_grant_attempt_protection"
  BEFORE INSERT OR UPDATE OR DELETE ON "rank_execution_grant_attempts"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_rank_execution_grant_attempt"();

CREATE FUNCTION "reject_rank_execution_grant_attempt_truncate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Rank execution grant attempts cannot be truncated'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_execution_grant_attempt_no_truncate"
  BEFORE TRUNCATE ON "rank_execution_grant_attempts"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "reject_rank_execution_grant_attempt_truncate"();

COMMIT;
