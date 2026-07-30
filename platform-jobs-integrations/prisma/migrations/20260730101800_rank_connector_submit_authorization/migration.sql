BEGIN;

-- The previous trigger cannot validate the generation backfill. Detach it
-- before expanding the row, then install the complete lifecycle guard below.
DROP TRIGGER "rank_connector_execution_claim_transition_guard"
  ON public.rank_connector_executions;

ALTER TABLE public.rank_connector_executions
  DROP CONSTRAINT "rank_connector_executions_shape",
  ADD COLUMN "lease_generation" INTEGER,
  ADD COLUMN "submit_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "submit_bytes_started_at" TIMESTAMPTZ(6);

-- Before this migration every version increment was one claim/reclaim. This
-- exact backfill therefore preserves the number of issued lease identities.
UPDATE public.rank_connector_executions execution
SET "lease_generation" = CASE
  WHEN execution."status" = 'CLAIMED'
    THEN execution."version" - 1
  ELSE 0
END;

ALTER TABLE public.rank_connector_executions
  ALTER COLUMN "lease_generation" SET NOT NULL,
  ALTER COLUMN "lease_generation" SET DEFAULT 0,
  ADD CONSTRAINT "rank_connector_executions_shape"
    CHECK (
      "execution_attempt" BETWEEN 1 AND 1000
      AND "job_version" > 0
      AND "manifest_chunk_index" BETWEEN 0 AND 3
      AND "binding_version" > 0
      AND "credential_version" > 0
      AND "credential_material_version" > 0
      AND "credential_validation_version" > 0
      AND octet_length("manifest_hash") = 32
      AND octet_length("estimate_execution_hash") = 32
      AND octet_length("execution_evidence_hash") = 32
      AND "credential_validation_connector_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "execution_connector_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "provider_policy_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "kill_switch_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "authorization_expires_at" > "created_at"
      AND "lease_generation" BETWEEN 0 AND 2147483646
      AND "submit_attempt_count" BETWEEN 0 AND 1
      AND (
        (
          "status" = 'READY_TO_SUBMIT'
          AND "lease_owner" IS NULL
          AND "lease_token" IS NULL
          AND "lease_expires_at" IS NULL
          AND "claimed_at" IS NULL
          AND "lease_generation" = 0
          AND "submit_attempt_count" = 0
          AND "submit_bytes_started_at" IS NULL
          AND "version" = 1
        )
        OR
        (
          "status" = 'CLAIMED'
          AND "lease_owner" IS NOT NULL
          AND "lease_owner" ~
            '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
          AND "lease_token" IS NOT NULL
          AND "lease_expires_at" IS NOT NULL
          AND "claimed_at" IS NOT NULL
          AND "lease_expires_at" > "claimed_at"
          AND "lease_expires_at" <= "authorization_expires_at"
          AND "claimed_at" >= "created_at"
          AND "lease_generation" >= 1
          AND "submit_attempt_count" = 0
          AND "submit_bytes_started_at" IS NULL
          AND "version" = "lease_generation" + 1
        )
        OR
        (
          "status" = 'SUBMITTING'
          AND "lease_owner" IS NOT NULL
          AND "lease_owner" ~
            '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
          AND "lease_token" IS NOT NULL
          AND "lease_expires_at" IS NOT NULL
          AND "claimed_at" IS NOT NULL
          AND "lease_expires_at" > "claimed_at"
          AND "lease_expires_at" <= "authorization_expires_at"
          AND "claimed_at" >= "created_at"
          AND "lease_generation" >= 1
          AND "submit_attempt_count" = 1
          AND "submit_bytes_started_at" IS NOT NULL
          AND "submit_bytes_started_at" >= "claimed_at"
          AND "submit_bytes_started_at" < "lease_expires_at"
          AND "submit_bytes_started_at" < "authorization_expires_at"
          AND "version" = "lease_generation" + 2
        )
      )
    );

COMMENT ON COLUMN
  public.rank_connector_executions."submit_bytes_started_at"
IS
  'Durable pre-network marker: after commit provider bytes may have started; automatic submit replay is forbidden.';

CREATE OR REPLACE FUNCTION
  public.assert_rank_connector_execution_claim_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."workspace_id",
    NEW."project_id",
    NEW."job_id",
    NEW."job_item_id",
    NEW."grant_attempt_id",
    NEW."execution_attempt",
    NEW."job_version",
    NEW."estimate_id",
    NEW."manifest_id",
    NEW."manifest_hash",
    NEW."manifest_chunk_index",
    NEW."binding_id",
    NEW."binding_version",
    NEW."route_id",
    NEW."credential_id",
    NEW."credential_version",
    NEW."credential_material_version",
    NEW."credential_validation_id",
    NEW."credential_validation_version",
    NEW."credential_validation_connector_version",
    NEW."credential_verified_at",
    NEW."estimate_execution_hash",
    NEW."execution_evidence_hash",
    NEW."execution_connector_version",
    NEW."provider_policy_version",
    NEW."kill_switch_version",
    NEW."authorization_expires_at",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."workspace_id",
    OLD."project_id",
    OLD."job_id",
    OLD."job_item_id",
    OLD."grant_attempt_id",
    OLD."execution_attempt",
    OLD."job_version",
    OLD."estimate_id",
    OLD."manifest_id",
    OLD."manifest_hash",
    OLD."manifest_chunk_index",
    OLD."binding_id",
    OLD."binding_version",
    OLD."route_id",
    OLD."credential_id",
    OLD."credential_version",
    OLD."credential_material_version",
    OLD."credential_validation_id",
    OLD."credential_validation_version",
    OLD."credential_validation_connector_version",
    OLD."credential_verified_at",
    OLD."estimate_execution_hash",
    OLD."execution_evidence_hash",
    OLD."execution_connector_version",
    OLD."provider_policy_version",
    OLD."kill_switch_version",
    OLD."authorization_expires_at",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Rank connector execution identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = 'CLAIMED' THEN
    -- The pre-authorization claim implementation predates this column. The
    -- lifecycle guard assigns the monotonic generation in the same row update.
    NEW."lease_generation" := OLD."lease_generation" + 1;

    IF NEW."version" <> OLD."version" + 1
      OR NEW."updated_at" <> NEW."claimed_at"
      OR NEW."claimed_at" < OLD."updated_at"
      OR NEW."lease_token" IS NOT DISTINCT FROM OLD."lease_token"
      OR NEW."submit_attempt_count" <> 0
      OR NEW."submit_bytes_started_at" IS NOT NULL
      OR NOT (
        OLD."status" = 'READY_TO_SUBMIT'
        OR (
          OLD."status" = 'CLAIMED'
          AND OLD."lease_expires_at" <= clock_timestamp()
        )
      )
    THEN
      RAISE EXCEPTION 'Invalid rank connector execution claim transition'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW."status" = 'SUBMITTING' THEN
    IF OLD."status" <> 'CLAIMED'
      OR NEW."version" <> OLD."version" + 1
      OR NEW."lease_generation" <> OLD."lease_generation"
      OR NEW."submit_attempt_count" <> 1
      OR OLD."submit_attempt_count" <> 0
      OR OLD."submit_bytes_started_at" IS NOT NULL
      OR NEW."submit_bytes_started_at" IS NULL
      OR NEW."updated_at" <> NEW."submit_bytes_started_at"
      OR NEW."submit_bytes_started_at" < OLD."claimed_at"
      OR NEW."submit_bytes_started_at" >= OLD."lease_expires_at"
      OR NEW."submit_bytes_started_at" >= OLD."authorization_expires_at"
      OR ROW(
        NEW."lease_owner",
        NEW."lease_token",
        NEW."lease_expires_at",
        NEW."claimed_at"
      ) IS DISTINCT FROM ROW(
        OLD."lease_owner",
        OLD."lease_token",
        OLD."lease_expires_at",
        OLD."claimed_at"
      )
    THEN
      RAISE EXCEPTION
        'Invalid rank connector execution submit authorization transition'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid rank connector execution lifecycle transition'
    USING ERRCODE = '23514';
END
$$;

CREATE FUNCTION public.authorize_rank_connector_execution_submit(
  p_workspace_id UUID,
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_lease_generation INTEGER,
  p_expected_version INTEGER,
  p_execution_connector_version TEXT
)
RETURNS TABLE (
  "executionId" UUID,
  "workspaceId" UUID,
  "jobId" UUID,
  "jobItemId" UUID,
  "leaseGeneration" INTEGER,
  "executionVersion" INTEGER,
  "submitAttemptCount" INTEGER,
  "submitBytesStartedAt" TIMESTAMPTZ,
  "authorizationExpiresAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  candidate public.rank_connector_executions%ROWTYPE;
  current_execution public.rank_connector_executions%ROWTYPE;
  current_control public.rank_connector_execution_controls%ROWTYPE;
  v_authorized_at TIMESTAMPTZ;
  v_authorized_version INTEGER;
BEGIN
  IF p_workspace_id IS NULL
    OR p_execution_id IS NULL
    OR p_lease_token IS NULL
    OR p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
    OR p_lease_generation IS NULL
    OR p_lease_generation NOT BETWEEN 1 AND 2147483646
    OR p_expected_version IS NULL
    OR p_expected_version NOT BETWEEN 2 AND 2147483646
    OR p_execution_connector_version IS NULL
    OR p_execution_connector_version !~
      '^[a-z0-9][a-z0-9@._-]{0,63}$'
  THEN
    RAISE EXCEPTION 'Invalid rank connector submit authorization identity'
      USING ERRCODE = '22023';
  END IF;

  -- Candidate discovery is deliberately non-locking. The operation acquires
  -- the parent Job first and never locks a child before that canonical root.
  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."id" = p_execution_id
    AND execution."status" = 'CLAIMED'
    AND execution."lease_owner" = p_lease_owner
    AND execution."lease_token" = p_lease_token
    AND execution."lease_generation" = p_lease_generation
    AND execution."version" = p_expected_version
    AND execution."execution_connector_version" =
      p_execution_connector_version
    AND execution."submit_attempt_count" = 0
    AND execution."submit_bytes_started_at" IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  /* rank-connector-authorize:job */
  PERFORM 1
  FROM public.jobs job
  WHERE job."workspace_id" = candidate."workspace_id"
    AND job."project_id" = candidate."project_id"
    AND job."id" = candidate."job_id"
    AND job."type" = 'MANUAL_RANK_CHECK'
    AND job."provider" = 'ARSENKIN'
    AND job."credential_mode" = 'BYOK_API_KEY'
    AND job."status" = 'RUNNING'
    AND job."stage" = 'WAITING_EXECUTION_GRANT'
    AND job."version" = candidate."job_version"
    AND job."cancel_requested_at" IS NULL
  FOR UPDATE OF job;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-authorize:run */
  PERFORM 1
  FROM public.rank_job_runs run
  WHERE run."workspace_id" = candidate."workspace_id"
    AND run."project_id" = candidate."project_id"
    AND run."job_id" = candidate."job_id"
    AND run."estimate_id" = candidate."estimate_id"
    AND run."seal_state" = 'SEALED'
    AND run."manifest_id" = candidate."manifest_id"
    AND run."manifest_hash" = candidate."manifest_hash"
    AND run."manifest_chunk_count" BETWEEN 1 AND 4
    AND candidate."manifest_chunk_index" >= 0
    AND candidate."manifest_chunk_index" < run."manifest_chunk_count"
    AND run."finalization_status" IS NULL
  FOR UPDATE OF run;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-authorize:item */
  PERFORM 1
  FROM public.job_items item
  WHERE item."workspace_id" = candidate."workspace_id"
    AND item."project_id" = candidate."project_id"
    AND item."job_id" = candidate."job_id"
    AND item."id" = candidate."job_item_id"
    AND item."sequence" = candidate."manifest_chunk_index"
    AND item."status" = 'QUEUED'
    AND item."provider_request_id" IS NULL
    AND item."output_reference" IS NULL
    AND item."actual_cost_micro" IS NULL
    AND item."error" IS NULL
    AND item."attempt" = 0
    AND item."retry_at" IS NULL
    AND item."input_reference" = jsonb_build_object(
      'schemaVersion', 'rank-job-item@1',
      'manifestId', candidate."manifest_id"::text,
      'chunkIndex', candidate."manifest_chunk_index"
    )
  FOR UPDATE OF item;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-authorize:credential */
  PERFORM 1
  FROM public.integration_credentials credential
  WHERE credential."workspace_id" = candidate."workspace_id"
    AND credential."id" = candidate."credential_id"
    AND credential."provider" = 'ARSENKIN'
    AND credential."mode" = 'BYOK_API_KEY'
    AND credential."status" = 'ACTIVE'
    AND credential."deleted_at" IS NULL
    AND credential."version" = candidate."credential_version"
    AND credential."material_version" =
      candidate."credential_material_version"
    AND credential."verified_at" = candidate."credential_verified_at"
  FOR UPDATE OF credential;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-authorize:validation */
  PERFORM 1
  FROM public.jobs validation
  WHERE validation."workspace_id" = candidate."workspace_id"
    AND validation."id" = candidate."credential_validation_id"
    AND validation."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
    AND validation."provider" = 'ARSENKIN'
    AND validation."credential_mode" = 'BYOK_API_KEY'
    AND validation."status" = 'COMPLETED'
    AND validation."version" =
      candidate."credential_validation_version"
    AND validation."input_snapshot" = jsonb_build_object(
      'kind', 'integration.credential.validation.v1',
      'credentialId', candidate."credential_id"::text,
      'credentialMaterialVersion',
        candidate."credential_material_version",
      'connectorVersion',
        candidate."credential_validation_connector_version"
    )
  FOR UPDATE OF validation;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-authorize:binding */
  PERFORM 1
  FROM public.project_connector_bindings binding
  WHERE binding."workspace_id" = candidate."workspace_id"
    AND binding."project_id" = candidate."project_id"
    AND binding."id" = candidate."binding_id"
    AND binding."capability" = 'SERP_RANK_TRACKING'
    AND binding."enabled"
    AND binding."version" = candidate."binding_version"
  FOR UPDATE OF binding;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-authorize:route */
  PERFORM 1
  FROM public.project_connector_routes route
  WHERE route."workspace_id" = candidate."workspace_id"
    AND route."project_id" = candidate."project_id"
    AND route."binding_id" = candidate."binding_id"
    AND route."id" = candidate."route_id"
    AND route."credential_id" = candidate."credential_id"
    AND route."position" = 0
    AND route."source_kind" = 'WORKSPACE_CREDENTIAL'
  FOR UPDATE OF route;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-authorize:grant */
  PERFORM 1
  FROM public.rank_execution_grant_attempts grant_attempt
  WHERE grant_attempt."id" = candidate."grant_attempt_id"
    AND grant_attempt."workspace_id" = candidate."workspace_id"
    AND grant_attempt."project_id" = candidate."project_id"
    AND grant_attempt."job_id" = candidate."job_id"
    AND grant_attempt."job_item_id" = candidate."job_item_id"
    AND grant_attempt."execution_attempt" = candidate."execution_attempt"
    AND grant_attempt."job_version" = candidate."job_version"
    AND grant_attempt."execution_evidence_hash" =
      candidate."execution_evidence_hash"
    AND grant_attempt."status" = 'CONSUMED'
    AND grant_attempt."expires_at" = candidate."authorization_expires_at"
  FOR UPDATE OF grant_attempt;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-authorize:execution */
  SELECT execution.*
  INTO current_execution
  FROM public.rank_connector_executions execution
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."id" = p_execution_id
    AND execution."status" = 'CLAIMED'
    AND execution."lease_owner" = p_lease_owner
    AND execution."lease_token" = p_lease_token
    AND execution."lease_generation" = p_lease_generation
    AND execution."version" = p_expected_version
    AND execution."execution_connector_version" =
      p_execution_connector_version
    AND execution."submit_attempt_count" = 0
    AND execution."submit_bytes_started_at" IS NULL
  FOR UPDATE OF execution;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-authorize:control */
  SELECT control.*
  INTO current_control
  FROM public.rank_connector_execution_controls control
  WHERE control."provider" = 'ARSENKIN'
    AND control."capability" = 'SERP_RANK_TRACKING'
  FOR SHARE OF control;
  IF NOT FOUND THEN RETURN; END IF;

  v_authorized_at := clock_timestamp();

  IF current_execution."lease_expires_at" <= v_authorized_at
    OR current_execution."authorization_expires_at" <= v_authorized_at
    OR NOT current_control."submit_enabled"
    OR current_control."execution_connector_version" <>
      p_execution_connector_version
    OR current_control."execution_connector_version" <>
      current_execution."execution_connector_version"
    OR current_control."provider_policy_version" <>
      current_execution."provider_policy_version"
    OR current_control."kill_switch_version" <>
      current_execution."kill_switch_version"
  THEN
    RETURN;
  END IF;

  -- All potentially blocking locks are held. Re-read the complete current
  -- graph under those locks before persisting the bytes-may-have-started
  -- boundary. No estimate/provider payload or credential material is returned.
  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs job
    JOIN public.rank_job_runs run
      ON run."workspace_id" = job."workspace_id"
      AND run."project_id" = job."project_id"
      AND run."job_id" = job."id"
    JOIN public.job_items item
      ON item."workspace_id" = job."workspace_id"
      AND item."project_id" = job."project_id"
      AND item."job_id" = job."id"
      AND item."id" = current_execution."job_item_id"
    JOIN public.integration_credentials credential
      ON credential."workspace_id" = job."workspace_id"
      AND credential."id" = current_execution."credential_id"
    JOIN public.jobs validation
      ON validation."workspace_id" = job."workspace_id"
      AND validation."id" =
        current_execution."credential_validation_id"
    JOIN public.project_connector_bindings binding
      ON binding."workspace_id" = job."workspace_id"
      AND binding."project_id" = job."project_id"
      AND binding."id" = current_execution."binding_id"
    JOIN public.project_connector_routes route
      ON route."workspace_id" = job."workspace_id"
      AND route."project_id" = job."project_id"
      AND route."binding_id" = binding."id"
      AND route."id" = current_execution."route_id"
      AND route."credential_id" = current_execution."credential_id"
    JOIN public.rank_execution_grant_attempts grant_attempt
      ON grant_attempt."id" = current_execution."grant_attempt_id"
      AND grant_attempt."workspace_id" = job."workspace_id"
      AND grant_attempt."project_id" = job."project_id"
      AND grant_attempt."job_id" = job."id"
      AND grant_attempt."job_item_id" = item."id"
    WHERE job."workspace_id" = p_workspace_id
      AND job."project_id" = current_execution."project_id"
      AND job."id" = current_execution."job_id"
      AND job."type" = 'MANUAL_RANK_CHECK'
      AND job."provider" = 'ARSENKIN'
      AND job."credential_mode" = 'BYOK_API_KEY'
      AND job."status" = 'RUNNING'
      AND job."stage" = 'WAITING_EXECUTION_GRANT'
      AND job."version" = current_execution."job_version"
      AND job."cancel_requested_at" IS NULL
      AND run."estimate_id" = current_execution."estimate_id"
      AND run."seal_state" = 'SEALED'
      AND run."manifest_id" = current_execution."manifest_id"
      AND run."manifest_hash" = current_execution."manifest_hash"
      AND run."manifest_chunk_count" BETWEEN 1 AND 4
      AND current_execution."manifest_chunk_index" >= 0
      AND current_execution."manifest_chunk_index" <
        run."manifest_chunk_count"
      AND run."finalization_status" IS NULL
      AND item."sequence" = current_execution."manifest_chunk_index"
      AND item."status" = 'QUEUED'
      AND item."provider_request_id" IS NULL
      AND item."output_reference" IS NULL
      AND item."actual_cost_micro" IS NULL
      AND item."error" IS NULL
      AND item."attempt" = 0
      AND item."retry_at" IS NULL
      AND item."input_reference" = jsonb_build_object(
        'schemaVersion', 'rank-job-item@1',
        'manifestId', current_execution."manifest_id"::text,
        'chunkIndex', current_execution."manifest_chunk_index"
      )
      AND credential."provider" = 'ARSENKIN'
      AND credential."mode" = 'BYOK_API_KEY'
      AND credential."status" = 'ACTIVE'
      AND credential."deleted_at" IS NULL
      AND credential."version" = current_execution."credential_version"
      AND credential."material_version" =
        current_execution."credential_material_version"
      AND credential."verified_at" =
        current_execution."credential_verified_at"
      AND validation."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
      AND validation."provider" = 'ARSENKIN'
      AND validation."credential_mode" = 'BYOK_API_KEY'
      AND validation."status" = 'COMPLETED'
      AND validation."version" =
        current_execution."credential_validation_version"
      AND validation."input_snapshot" = jsonb_build_object(
        'kind', 'integration.credential.validation.v1',
        'credentialId', current_execution."credential_id"::text,
        'credentialMaterialVersion',
          current_execution."credential_material_version",
        'connectorVersion',
          current_execution."credential_validation_connector_version"
      )
      AND binding."capability" = 'SERP_RANK_TRACKING'
      AND binding."enabled"
      AND binding."version" = current_execution."binding_version"
      AND route."position" = 0
      AND route."source_kind" = 'WORKSPACE_CREDENTIAL'
      AND grant_attempt."execution_attempt" =
        current_execution."execution_attempt"
      AND grant_attempt."job_version" = current_execution."job_version"
      AND grant_attempt."execution_evidence_hash" =
        current_execution."execution_evidence_hash"
      AND grant_attempt."status" = 'CONSUMED'
      AND grant_attempt."expires_at" =
        current_execution."authorization_expires_at"
      AND grant_attempt."expires_at" > v_authorized_at
  ) THEN
    RETURN;
  END IF;

  UPDATE public.rank_connector_executions execution
  SET
    "status" = 'SUBMITTING',
    "submit_attempt_count" = 1,
    "submit_bytes_started_at" = v_authorized_at,
    "version" = execution."version" + 1,
    "updated_at" = v_authorized_at
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."id" = p_execution_id
    AND execution."status" = 'CLAIMED'
    AND execution."lease_owner" = p_lease_owner
    AND execution."lease_token" = p_lease_token
    AND execution."lease_generation" = p_lease_generation
    AND execution."version" = p_expected_version
    AND execution."execution_connector_version" =
      p_execution_connector_version
    AND execution."submit_attempt_count" = 0
    AND execution."submit_bytes_started_at" IS NULL
    AND execution."lease_expires_at" > v_authorized_at
    AND execution."authorization_expires_at" > v_authorized_at
  RETURNING execution."version"
  INTO v_authorized_version;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- This permit is intentionally secret-free. The caller must commit the
  -- function result before sending bytes; SUBMITTING is never auto-reclaimed.
  RETURN QUERY
  SELECT
    current_execution."id",
    current_execution."workspace_id",
    current_execution."job_id",
    current_execution."job_item_id",
    current_execution."lease_generation",
    v_authorized_version,
    1,
    v_authorized_at,
    current_execution."authorization_expires_at";
END
$$;

CREATE TRIGGER "rank_connector_execution_claim_transition_guard"
  BEFORE UPDATE ON public.rank_connector_executions
  FOR EACH ROW
  EXECUTE FUNCTION
    public.assert_rank_connector_execution_claim_transition();

-- Preserve the proven claim graph/lock implementation as a private owner-only
-- primitive. Its UPDATE passes through the new trigger, which atomically
-- increments lease_generation. The same public signature is recreated below
-- with generation/version in its exact result.
ALTER FUNCTION
  public.claim_rank_connector_execution(TEXT, INTEGER, TEXT)
  RENAME TO claim_rank_connector_execution_pre_authorization;

-- ALTER FUNCTION RENAME preserves the function OID and therefore every
-- explicit pre-existing EXECUTE ACL. Revoke all non-owner grantees now, in
-- the same migration, so a previously provisioned connector role cannot call
-- the renamed encrypted-credential primitive after the upgrade.
DO $$
DECLARE
  execute_acl RECORD;
BEGIN
  FOR execute_acl IN
    SELECT
      privilege.grantee,
      grantee_role.rolname
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace
      ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) privilege
    LEFT JOIN pg_catalog.pg_roles grantee_role
      ON grantee_role.oid = privilege.grantee
    WHERE namespace.nspname = 'public'
      AND procedure.oid =
        'public.claim_rank_connector_execution_pre_authorization(text,integer,text)'::regprocedure
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> procedure.proowner
  LOOP
    IF execute_acl.grantee = 0 THEN
      EXECUTE
        'REVOKE ALL ON FUNCTION public.claim_rank_connector_execution_pre_authorization(text,integer,text) FROM PUBLIC';
    ELSIF execute_acl.rolname IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION public.claim_rank_connector_execution_pre_authorization(text,integer,text) FROM %I',
        execute_acl.rolname
      );
    END IF;
  END LOOP;
END
$$;

CREATE FUNCTION public.claim_rank_connector_execution(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER,
  p_execution_connector_version TEXT
)
RETURNS TABLE (
  "executionId" UUID,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ,
  "workspaceId" UUID,
  "provider" VARCHAR(64),
  "credentialId" UUID,
  "credentialMaterialVersion" INTEGER,
  "ciphertext" BYTEA,
  "nonce" BYTEA,
  "authTag" BYTEA,
  "encryptedDataKey" BYTEA,
  "dataKeyNonce" BYTEA,
  "dataKeyAuthTag" BYTEA,
  "keyVersion" INTEGER,
  "leaseGeneration" INTEGER,
  "executionVersion" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  claimed_result RECORD;
  claimed_generation INTEGER;
  claimed_version INTEGER;
BEGIN
  SELECT claimed.*
  INTO claimed_result
  FROM public.claim_rank_connector_execution_pre_authorization(
    p_lease_owner,
    p_lease_seconds,
    p_execution_connector_version
  ) claimed;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Use a new PL/pgSQL statement after the mutating primitive. A table scan
  -- in the same SQL statement as the volatile SRF can retain its earlier
  -- snapshot and miss the just-claimed row.
  SELECT
    execution."lease_generation",
    execution."version"
  INTO
    claimed_generation,
    claimed_version
  FROM public.rank_connector_executions execution
  WHERE execution."id" = claimed_result."executionId"
    AND execution."lease_token" = claimed_result."leaseToken"
    AND execution."status" = 'CLAIMED';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    claimed_result."executionId"::UUID,
    claimed_result."leaseToken"::UUID,
    claimed_result."leaseExpiresAt"::TIMESTAMPTZ,
    claimed_result."workspaceId"::UUID,
    claimed_result."provider"::VARCHAR(64),
    claimed_result."credentialId"::UUID,
    claimed_result."credentialMaterialVersion"::INTEGER,
    claimed_result."ciphertext"::BYTEA,
    claimed_result."nonce"::BYTEA,
    claimed_result."authTag"::BYTEA,
    claimed_result."encryptedDataKey"::BYTEA,
    claimed_result."dataKeyNonce"::BYTEA,
    claimed_result."dataKeyAuthTag"::BYTEA,
    claimed_result."keyVersion"::INTEGER,
    claimed_generation,
    claimed_version;
END
$$;

REVOKE ALL ON FUNCTION
  public.assert_rank_connector_execution_claim_transition()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.claim_rank_connector_execution_pre_authorization(
    TEXT, INTEGER, TEXT
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.claim_rank_connector_execution(TEXT, INTEGER, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.authorize_rank_connector_execution_submit(
    UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT
  )
  FROM PUBLIC;

COMMIT;
