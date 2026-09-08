BEGIN;
-- Add new immutable batching policies. No historical rows or hashes are rewritten.

ALTER TABLE public.rank_estimates DROP CONSTRAINT rank_estimates_counts_bounded, ADD CONSTRAINT rank_estimates_counts_bounded CHECK ((((keyword_count >= 0) AND (provider_task_count >= 0) AND (minimum_submit_request_count >= 0) AND (minimum_check_request_count >= 0) AND (minimum_get_request_count >= 0) AND ((((provider)::text = 'ARSENKIN'::text) AND ((provider_policy_version)::text = 'manual-arsenkin-positions@1.0.0'::text) AND (keyword_count <= 1001) AND (provider_task_count <= 4) AND (minimum_submit_request_count = provider_task_count) AND (minimum_check_request_count = provider_task_count) AND (minimum_get_request_count = provider_task_count) AND (((keyword_count <= 1000) AND (provider_task_count = ((keyword_count + 249) / 250))) OR ((keyword_count = 1001) AND (provider_task_count = 0)))) OR (((provider)::text = 'ARSENKIN'::text) AND ((provider_policy_version)::text = 'manual-arsenkin-positions@2.0.0'::text) AND (keyword_count <= 15001) AND (provider_task_count <= 1) AND (minimum_submit_request_count = provider_task_count) AND (minimum_check_request_count = provider_task_count) AND (minimum_get_request_count = provider_task_count) AND ((((keyword_count >= 1) AND (keyword_count <= 15000)) AND (provider_task_count = 1)) OR ((keyword_count = ANY (ARRAY[0, 15001])) AND (provider_task_count = 0)))) OR (((provider)::text = 'XMLSTOCK'::text) AND ((provider_policy_version)::text = 'manual-xmlstock-serp@1.0.0'::text) AND (keyword_count <= 15001) AND (provider_task_count <= 15000) AND ((((keyword_count >= 1) AND (keyword_count <= 15000)) AND (provider_task_count = keyword_count)) OR ((keyword_count = ANY (ARRAY[0, 15001])) AND (provider_task_count = 0))) AND (execution_snapshot IS NOT NULL) AND ((((execution_snapshot ->> 'searchEngine'::text) = 'YANDEX'::text) AND ((execution_snapshot ->> 'providerMappingVersion'::text) = ANY (ARRAY['xmlstock-serp@1'::text, 'xmlstock-yandex-search-api@2'::text])) AND (minimum_submit_request_count = provider_task_count) AND (minimum_check_request_count = provider_task_count) AND (minimum_get_request_count = 0)) OR (((execution_snapshot ->> 'searchEngine'::text) = 'YANDEX'::text) AND ((execution_snapshot ->> 'providerMappingVersion'::text) = 'xmlstock-yandex-live@2'::text) AND (minimum_submit_request_count = 0) AND (minimum_check_request_count = 0) AND (minimum_get_request_count = (provider_task_count * ((
CASE
    WHEN ((execution_snapshot ->> 'purpose'::text) = 'COMPETITOR_SERP'::text) THEN 10
    ELSE ((execution_snapshot ->> 'depth'::text))::integer
END + 9) / 10)))) OR (((execution_snapshot ->> 'searchEngine'::text) = 'YANDEX'::text) AND ((execution_snapshot ->> 'providerMappingVersion'::text) = 'xmlstock-yandex-live@3'::text) AND (minimum_submit_request_count = 0) AND (minimum_check_request_count = 0) AND (minimum_get_request_count = (provider_task_count * ((
CASE
    WHEN ((execution_snapshot ->> 'purpose'::text) = 'COMPETITOR_SERP'::text) THEN 10
    ELSE ((execution_snapshot ->> 'depth'::text))::integer
END + 49) / 50)))) OR (((execution_snapshot ->> 'searchEngine'::text) = 'GOOGLE'::text) AND ((execution_snapshot ->> 'providerMappingVersion'::text) = ANY (ARRAY['xmlstock-serp@1'::text, 'xmlstock-google-live@2'::text])) AND (minimum_submit_request_count = 0) AND (minimum_check_request_count = 0) AND (minimum_get_request_count = (provider_task_count * ((
CASE
    WHEN ((execution_snapshot ->> 'purpose'::text) = 'COMPETITOR_SERP'::text) THEN 10
    ELSE ((execution_snapshot ->> 'depth'::text))::integer
END + 9) / 10))))))))) OR (provider = 'ARSENKIN' AND provider_policy_version = 'manual-arsenkin-positions@3.0.0'
 AND keyword_count BETWEEN 0 AND 300001 AND provider_task_count BETWEEN 0 AND 60
 AND minimum_submit_request_count = provider_task_count
 AND minimum_check_request_count = provider_task_count
 AND minimum_get_request_count = provider_task_count
 AND ((keyword_count BETWEEN 0 AND 300000 AND provider_task_count = (keyword_count + 4999) / 5000)
   OR (keyword_count = 300001 AND provider_task_count = 0))) OR (minimum_submit_request_count >= 0 AND minimum_check_request_count >= 0 AND minimum_get_request_count >= 0 AND (
        provider = 'XMLSTOCK'
        AND provider_policy_version = 'manual-xmlstock-serp@2.0.0'
        AND keyword_count <= 300001
        AND provider_task_count <= 300000
        AND (
          (keyword_count BETWEEN 1 AND 300000 AND provider_task_count = keyword_count)
          OR (keyword_count IN (0, 300001) AND provider_task_count = 0)
        )
        AND execution_snapshot IS NOT NULL
        AND (
          (
            execution_snapshot ->> 'searchEngine' = 'YANDEX'
            AND execution_snapshot ->> 'providerMappingVersion' IN (
              'xmlstock-serp@1',
              'xmlstock-yandex-search-api@2'
            )
            AND minimum_submit_request_count = provider_task_count
            AND minimum_check_request_count = provider_task_count
            AND minimum_get_request_count = 0
          )
          OR (
            execution_snapshot ->> 'searchEngine' = 'YANDEX'
            AND execution_snapshot ->> 'providerMappingVersion' =
              'xmlstock-yandex-live@2'
            AND minimum_submit_request_count = 0
            AND minimum_check_request_count = 0
            AND minimum_get_request_count = provider_task_count *
              (((CASE
                WHEN execution_snapshot ->> 'purpose' = 'COMPETITOR_SERP'
                  THEN 10
                ELSE (execution_snapshot ->> 'depth')::integer
              END) + 9) / 10)
          )
          OR (
            execution_snapshot ->> 'searchEngine' = 'YANDEX'
            AND execution_snapshot ->> 'providerMappingVersion' =
              'xmlstock-yandex-live@3'
            AND minimum_submit_request_count = 0
            AND minimum_check_request_count = 0
            AND minimum_get_request_count = provider_task_count *
              (((CASE
                WHEN execution_snapshot ->> 'purpose' = 'COMPETITOR_SERP'
                  THEN 10
                ELSE (execution_snapshot ->> 'depth')::integer
              END) + 49) / 50)
          )
          OR (
            execution_snapshot ->> 'searchEngine' = 'GOOGLE'
            AND execution_snapshot ->> 'providerMappingVersion' IN (
              'xmlstock-serp@1',
              'xmlstock-google-live@2'
            )
            AND minimum_submit_request_count = 0
            AND minimum_check_request_count = 0
            AND minimum_get_request_count = provider_task_count *
              (((CASE
                WHEN execution_snapshot ->> 'purpose' = 'COMPETITOR_SERP'
                  THEN 10
                ELSE (execution_snapshot ->> 'depth')::integer
              END) + 9) / 10)
          )
        )
      ))) NOT VALID;
ALTER TABLE public.rank_estimates VALIDATE CONSTRAINT rank_estimates_counts_bounded;

ALTER TABLE public.rank_estimates DROP CONSTRAINT rank_estimates_scope_hash_availability, ADD CONSTRAINT rank_estimates_scope_hash_availability CHECK ((((((provider)::text = 'ARSENKIN'::text) AND ((provider_policy_version)::text = 'manual-arsenkin-positions@1.0.0'::text) AND ((((keyword_count >= 0) AND (keyword_count <= 1000)) AND (semantic_scope_hash IS NOT NULL) AND (scope_hash IS NOT NULL) AND (octet_length(semantic_scope_hash) = 32) AND (octet_length(scope_hash) = 32)) OR (((keyword_count >= 1) AND (keyword_count <= 1001)) AND (semantic_scope_hash IS NULL) AND (scope_hash IS NULL)))) OR (((provider)::text = 'ARSENKIN'::text) AND ((provider_policy_version)::text = 'manual-arsenkin-positions@2.0.0'::text) AND ((((keyword_count >= 0) AND (keyword_count <= 15000)) AND (semantic_scope_hash IS NOT NULL) AND (scope_hash IS NOT NULL) AND (octet_length(semantic_scope_hash) = 32) AND (octet_length(scope_hash) = 32)) OR (((keyword_count >= 1) AND (keyword_count <= 15001)) AND (semantic_scope_hash IS NULL) AND (scope_hash IS NULL)))) OR (((provider)::text = 'XMLSTOCK'::text) AND ((provider_policy_version)::text = 'manual-xmlstock-serp@1.0.0'::text) AND ((((keyword_count >= 0) AND (keyword_count <= 15000)) AND (semantic_scope_hash IS NOT NULL) AND (scope_hash IS NOT NULL) AND (octet_length(semantic_scope_hash) = 32) AND (octet_length(scope_hash) = 32)) OR (((keyword_count >= 1) AND (keyword_count <= 15001)) AND (semantic_scope_hash IS NULL) AND (scope_hash IS NULL)))))) OR (((provider = 'ARSENKIN' AND provider_policy_version = 'manual-arsenkin-positions@3.0.0')
 OR (provider = 'XMLSTOCK' AND provider_policy_version = 'manual-xmlstock-serp@2.0.0'))
 AND ((keyword_count BETWEEN 0 AND 300000 AND semantic_scope_hash IS NOT NULL AND scope_hash IS NOT NULL
       AND octet_length(semantic_scope_hash) = 32 AND octet_length(scope_hash) = 32)
   OR (keyword_count BETWEEN 1 AND 300001 AND semantic_scope_hash IS NULL AND scope_hash IS NULL)))) NOT VALID;
ALTER TABLE public.rank_estimates VALIDATE CONSTRAINT rank_estimates_scope_hash_availability;

ALTER TABLE public.rank_job_runs DROP CONSTRAINT rank_job_runs_manifest_receipt, ADD CONSTRAINT rank_job_runs_manifest_receipt CHECK (
 (seal_state IN ('PENDING', 'OUTCOME_UNKNOWN', 'NOT_SEALED')
  AND manifest_id IS NULL AND manifest_hash_schema IS NULL AND manifest_hash IS NULL
  AND manifest_deduplication_hash IS NULL AND manifest_pair_count IS NULL
  AND manifest_chunk_count IS NULL AND manifest_chunk_size IS NULL AND manifest_sealed_at IS NULL)
 OR (seal_state IN ('SEALED', 'FINALIZED') AND manifest_id IS NOT NULL
  AND manifest_hash_schema = 'rank-manifest@1' AND manifest_hash IS NOT NULL AND octet_length(manifest_hash) = 32
  AND manifest_deduplication_hash IS NOT NULL AND octet_length(manifest_deduplication_hash) = 32 AND manifest_sealed_at IS NOT NULL
  AND ((manifest_pair_count BETWEEN 1 AND 1000 AND manifest_chunk_size = 250 AND manifest_chunk_count = (manifest_pair_count + 249) / 250)
   OR (manifest_pair_count BETWEEN 1 AND 15000 AND manifest_chunk_size = 15000 AND manifest_chunk_count = 1)
   OR (manifest_pair_count BETWEEN 1 AND 300000 AND manifest_chunk_size = 5000 AND manifest_chunk_count = (manifest_pair_count + 4999) / 5000)
   OR (manifest_pair_count BETWEEN 1 AND 300000 AND manifest_chunk_size = 1 AND manifest_chunk_count = manifest_pair_count)))
) NOT VALID;
ALTER TABLE public.rank_job_runs VALIDATE CONSTRAINT rank_job_runs_manifest_receipt;

ALTER TABLE public.rank_connector_executions DROP CONSTRAINT rank_connector_executions_shape, ADD CONSTRAINT rank_connector_executions_shape CHECK (((execution_attempt >= 1) AND (execution_attempt <= 1000) AND (job_version > 0) AND ((manifest_chunk_index >= 0) AND (manifest_chunk_index <= 299999)) AND (binding_version > 0) AND (credential_version > 0) AND (credential_material_version > 0) AND (credential_validation_version > 0) AND (octet_length(manifest_hash) = 32) AND (octet_length(estimate_execution_hash) = 32) AND (octet_length(execution_evidence_hash) = 32) AND ((credential_validation_connector_version)::text ~ '^[a-z0-9][a-z0-9@._-]{0,63}$'::text) AND ((execution_connector_version)::text ~ '^[a-z0-9][a-z0-9@._-]{0,63}$'::text) AND ((provider_policy_version)::text ~ '^[a-z0-9][a-z0-9@._-]{0,63}$'::text) AND ((kill_switch_version)::text ~ '^[a-z0-9][a-z0-9@._-]{0,63}$'::text) AND (authorization_expires_at > created_at) AND ((lease_generation >= 0) AND (lease_generation <= 2147483646)) AND ((submit_attempt_count >= 0) AND (submit_attempt_count <= 1)) AND ((poll_attempt_count >= 0) AND (poll_attempt_count <= 720)) AND ((provider_task_id IS NULL) OR ((provider_task_id)::text ~ '^[A-Za-z0-9_-]{1,100}$'::text)) AND ((provider_wire_request_hash IS NULL) OR (octet_length(provider_wire_request_hash) = 32)) AND ((normalized_result_hash IS NULL) OR (octet_length(normalized_result_hash) = 32)) AND ((last_error_code IS NULL) OR ((last_error_code)::text ~ '^[A-Z0-9_]{1,100}$'::text)) AND (((status = 'READY_TO_SUBMIT'::"RankConnectorExecutionStatus") AND (lease_owner IS NULL) AND (lease_token IS NULL) AND (lease_expires_at IS NULL) AND (claimed_at IS NULL) AND (lease_generation = 0) AND (submit_attempt_count = 0) AND (submit_bytes_started_at IS NULL) AND (provider_wire_request_snapshot IS NULL) AND (provider_wire_request_hash IS NULL) AND (provider_task_id IS NULL) AND (provider_submitted_at IS NULL) AND (poll_attempt_count = 0) AND (next_action_at IS NULL) AND (observed_at IS NULL) AND (normalized_result_snapshot IS NULL) AND (normalized_result_hash IS NULL) AND (last_error_code IS NULL) AND (finished_at IS NULL) AND (version = 1)) OR ((status = 'CLAIMED'::"RankConnectorExecutionStatus") AND (lease_owner IS NOT NULL) AND ((lease_owner)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'::text) AND (lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (claimed_at IS NOT NULL) AND (lease_expires_at > claimed_at) AND (lease_expires_at <= authorization_expires_at) AND (claimed_at >= created_at) AND (lease_generation >= 1) AND (submit_attempt_count = 0) AND (submit_bytes_started_at IS NULL) AND (provider_wire_request_snapshot IS NULL) AND (provider_wire_request_hash IS NULL) AND (provider_task_id IS NULL) AND (provider_submitted_at IS NULL) AND (poll_attempt_count = 0) AND (next_action_at IS NULL) AND (observed_at IS NULL) AND (normalized_result_snapshot IS NULL) AND (normalized_result_hash IS NULL) AND (last_error_code IS NULL) AND (finished_at IS NULL)) OR ((status = 'SUBMITTING'::"RankConnectorExecutionStatus") AND (lease_owner IS NOT NULL) AND ((lease_owner)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'::text) AND (lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (claimed_at IS NOT NULL) AND (lease_expires_at > claimed_at) AND (lease_expires_at <= authorization_expires_at) AND (submit_attempt_count = 1) AND (submit_bytes_started_at >= claimed_at) AND (submit_bytes_started_at < lease_expires_at) AND (provider_wire_request_snapshot IS NULL) AND (provider_wire_request_hash IS NULL) AND (provider_task_id IS NULL) AND (provider_submitted_at IS NULL) AND (poll_attempt_count = 0) AND (next_action_at IS NULL) AND (observed_at IS NULL) AND (normalized_result_snapshot IS NULL) AND (normalized_result_hash IS NULL) AND (last_error_code IS NULL) AND (finished_at IS NULL)) OR ((status = 'POLL_WAIT'::"RankConnectorExecutionStatus") AND (lease_owner IS NULL) AND (lease_token IS NULL) AND (lease_expires_at IS NULL) AND (claimed_at IS NULL) AND (submit_attempt_count = 1) AND (submit_bytes_started_at IS NOT NULL) AND (provider_wire_request_snapshot IS NOT NULL) AND (provider_wire_request_hash IS NOT NULL) AND (provider_task_id IS NOT NULL) AND (provider_submitted_at IS NOT NULL) AND (next_action_at IS NOT NULL) AND (observed_at IS NULL) AND (normalized_result_snapshot IS NULL) AND (normalized_result_hash IS NULL) AND (last_error_code IS NULL) AND (finished_at IS NULL)) OR ((status = 'FETCHING'::"RankConnectorExecutionStatus") AND (lease_owner IS NOT NULL) AND ((lease_owner)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'::text) AND (lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (claimed_at IS NOT NULL) AND (lease_expires_at > claimed_at) AND (submit_attempt_count = 1) AND (submit_bytes_started_at IS NOT NULL) AND (provider_wire_request_snapshot IS NOT NULL) AND (provider_wire_request_hash IS NOT NULL) AND (provider_task_id IS NOT NULL) AND (provider_submitted_at IS NOT NULL) AND ((poll_attempt_count >= 1) AND (poll_attempt_count <= 720)) AND (next_action_at IS NULL) AND (observed_at IS NULL) AND (normalized_result_snapshot IS NULL) AND (normalized_result_hash IS NULL) AND (last_error_code IS NULL) AND (finished_at IS NULL)) OR ((status = ANY (ARRAY['STAGED'::"RankConnectorExecutionStatus", 'PERSISTED'::"RankConnectorExecutionStatus"])) AND (lease_owner IS NULL) AND (lease_token IS NULL) AND (lease_expires_at IS NULL) AND (claimed_at IS NULL) AND (submit_attempt_count = 1) AND (submit_bytes_started_at IS NOT NULL) AND (provider_wire_request_snapshot IS NOT NULL) AND (provider_wire_request_hash IS NOT NULL) AND (provider_task_id IS NOT NULL) AND (provider_submitted_at IS NOT NULL) AND ((poll_attempt_count >= 1) AND (poll_attempt_count <= 720)) AND (next_action_at IS NULL) AND (observed_at IS NOT NULL) AND (normalized_result_snapshot IS NOT NULL) AND (normalized_result_hash IS NOT NULL) AND (last_error_code IS NULL) AND (((status = 'STAGED'::"RankConnectorExecutionStatus") AND (finished_at IS NULL)) OR ((status = 'PERSISTED'::"RankConnectorExecutionStatus") AND (finished_at IS NOT NULL)))) OR ((status = 'PERSISTING'::"RankConnectorExecutionStatus") AND (lease_owner IS NOT NULL) AND ((lease_owner)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'::text) AND (lease_token IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (claimed_at IS NOT NULL) AND (lease_expires_at > claimed_at) AND (submit_attempt_count = 1) AND (submit_bytes_started_at IS NOT NULL) AND (provider_wire_request_snapshot IS NOT NULL) AND (provider_wire_request_hash IS NOT NULL) AND (provider_task_id IS NOT NULL) AND (provider_submitted_at IS NOT NULL) AND ((poll_attempt_count >= 1) AND (poll_attempt_count <= 720)) AND (next_action_at IS NULL) AND (observed_at IS NOT NULL) AND (normalized_result_snapshot IS NOT NULL) AND (normalized_result_hash IS NOT NULL) AND (last_error_code IS NULL) AND (finished_at IS NULL)) OR ((status = ANY (ARRAY['SUBMIT_OUTCOME_UNKNOWN'::"RankConnectorExecutionStatus", 'FAILED_RETRYABLE'::"RankConnectorExecutionStatus", 'FAILED_FINAL'::"RankConnectorExecutionStatus"])) AND (lease_owner IS NULL) AND (lease_token IS NULL) AND (lease_expires_at IS NULL) AND (claimed_at IS NULL) AND (submit_attempt_count = 1) AND (submit_bytes_started_at IS NOT NULL) AND (provider_wire_request_snapshot IS NOT NULL) AND (provider_wire_request_hash IS NOT NULL) AND (next_action_at IS NULL) AND (observed_at IS NULL) AND (normalized_result_snapshot IS NULL) AND (normalized_result_hash IS NULL) AND (last_error_code IS NOT NULL) AND (finished_at IS NOT NULL))))) NOT VALID;
ALTER TABLE public.rank_connector_executions VALIDATE CONSTRAINT rank_connector_executions_shape;

ALTER TABLE public.rank_provider_request_intents DROP CONSTRAINT rank_provider_request_intents_shape, ADD CONSTRAINT rank_provider_request_intents_shape CHECK (((octet_length(manifest_hash) = 32) AND ((manifest_chunk_index >= 0) AND (manifest_chunk_index <= 299999)) AND (octet_length(manifest_chunk_hash) = 32) AND ((schema_version)::text = 'rank-provider-request-intent@1'::text) AND (jsonb_typeof(request_snapshot) = 'object'::text) AND (octet_length((request_snapshot)::text) <= 67108864) AND (octet_length(request_hash) = 32))) NOT VALID;
ALTER TABLE public.rank_provider_request_intents VALIDATE CONSTRAINT rank_provider_request_intents_shape;

CREATE OR REPLACE FUNCTION public.assert_manual_rank_job_shape()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."type" <> 'MANUAL_RANK_CHECK' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW."status" <> 'PREPARING'
    OR NEW."version" <> 1
    OR NEW."attempt" <> 0
    OR NEW."progress_current" <> 0
    OR NEW."reserved_cost_micro" IS NOT NULL
    OR NEW."actual_cost_micro" IS NOT NULL
    OR NEW."error_summary" IS NOT NULL
    OR NEW."result_summary" IS NOT NULL
    OR NEW."cancel_requested_at" IS NOT NULL
    OR NEW."lease_owner" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."retry_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'MANUAL_RANK_CHECK must start in PREPARING version 1 attempt 0'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."project_id" IS NULL
    OR NEW."actor_id" IS NULL
    OR NEW."idempotency_key" IS NULL
    OR NEW."request_hash" IS NULL
    OR octet_length(NEW."request_hash") <> 32
    OR NEW."deduplication_key" IS NULL
    OR NEW."credential_mode" NOT IN ('BYOK_API_KEY', 'PLATFORM_PAID')
    OR NEW."provider" NOT IN ('ARSENKIN', 'XMLSTOCK')
    OR NEW."progress_total" IS NULL
    OR NEW."progress_total" NOT BETWEEN 1 AND 300000
    OR NEW."progress_current" < 0
    OR NEW."progress_current" > NEW."progress_total"
    OR NEW."progress_unit" IS DISTINCT FROM 'KEYWORD'
    OR (NEW."credential_mode" = 'BYOK_API_KEY'
      AND NEW."estimated_cost_micro" IS DISTINCT FROM 0)
    OR (NEW."credential_mode" = 'PLATFORM_PAID'
      AND (
        NEW."estimated_cost_micro" IS NULL
        OR NEW."estimated_cost_micro" <= 0
        OR mod(NEW."estimated_cost_micro", 10000) <> 0
      ))
    OR NEW."currency" IS NULL
    OR NEW."max_attempts" NOT BETWEEN 1 AND 1000
    OR NEW."attempt" NOT BETWEEN 0 AND NEW."max_attempts"
  THEN
    RAISE EXCEPTION 'Invalid MANUAL_RANK_CHECK job shape'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" NOT IN (
    'PREPARING',
    'QUEUED',
    'RUNNING',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'PARTIALLY_COMPLETED',
    'COMPLETED',
    'FAILED_FINAL',
    'ACTION_REQUIRED',
    'EXPIRED'
  ) THEN
    RAISE EXCEPTION 'Unsupported MANUAL_RANK_CHECK job status'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'PREPARING' AND (
    NEW."stage" IS DISTINCT FROM 'PREPARING_SCOPE'
    OR NEW."queued_at" IS NOT NULL
    OR NEW."started_at" IS NOT NULL
    OR NEW."finished_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid PREPARING rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'QUEUED' AND (
    NEW."stage" IS DISTINCT FROM 'WAITING_FOR_QUEUE'
    OR NEW."queued_at" IS NULL
    OR NEW."started_at" IS NOT NULL
    OR NEW."finished_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid QUEUED rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'CANCEL_REQUESTED' AND (
    NEW."cancel_requested_at" IS NULL
    OR NEW."finished_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid CANCEL_REQUESTED rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IN (
    'CANCELLED',
    'PARTIALLY_COMPLETED',
    'COMPLETED',
    'FAILED_FINAL',
    'EXPIRED'
  ) AND (
    NEW."stage" IS DISTINCT FROM 'FINISHED'
    OR NEW."finished_at" IS NULL
    OR NEW."lease_owner" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."retry_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid terminal rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'ACTION_REQUIRED' AND (
    NEW."stage" IS DISTINCT FROM 'SUBMIT_OUTCOME_UNKNOWN'
    OR NEW."finished_at" IS NULL
    OR NEW."lease_owner" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."retry_at" IS NOT NULL
    OR NEW."error_summary"
      IS DISTINCT FROM '{"code":"SUBMIT_OUTCOME_UNKNOWN"}'::jsonb
    OR NOT public.manual_rank_action_result_is_coherent(
      NEW."result_summary",
      NEW."progress_total",
      NEW."progress_current"
    )
  ) THEN
    RAISE EXCEPTION 'Invalid ACTION_REQUIRED rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.assert_rank_connector_execution_scope()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Rank connector execution identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.provider NOT IN ('ARSENKIN', 'XMLSTOCK') OR NOT EXISTS (
    SELECT 1
    FROM public.rank_execution_grant_attempts attempt
    JOIN public.jobs job
      ON job.workspace_id = attempt.workspace_id
      AND job.project_id = attempt.project_id
      AND job.id = attempt.job_id
    JOIN public.rank_job_runs run
      ON run.workspace_id = attempt.workspace_id
      AND run.project_id = attempt.project_id
      AND run.job_id = attempt.job_id
    JOIN public.rank_estimates estimate
      ON estimate.workspace_id = run.workspace_id
      AND estimate.project_id = run.project_id
      AND estimate.id = run.estimate_id
    JOIN public.job_items item
      ON item.workspace_id = attempt.workspace_id
      AND item.project_id = attempt.project_id
      AND item.job_id = attempt.job_id
      AND item.id = attempt.job_item_id
    JOIN public.integration_credentials credential
      ON credential.workspace_id = attempt.workspace_id
      AND credential.id = NEW.credential_id
    JOIN public.jobs validation
      ON validation.workspace_id = attempt.workspace_id
      AND validation.id = NEW.credential_validation_id
    JOIN public.project_connector_bindings binding
      ON binding.workspace_id = attempt.workspace_id
      AND binding.project_id = attempt.project_id
      AND binding.id = NEW.binding_id
    JOIN public.project_connector_routes route
      ON route.workspace_id = attempt.workspace_id
      AND route.project_id = attempt.project_id
      AND route.binding_id = NEW.binding_id
      AND route.id = NEW.route_id
      AND route.credential_id = NEW.credential_id
    WHERE attempt.id = NEW.grant_attempt_id
      AND attempt.workspace_id = NEW.workspace_id
      AND attempt.project_id = NEW.project_id
      AND attempt.job_id = NEW.job_id
      AND attempt.job_item_id = NEW.job_item_id
      AND attempt.execution_attempt = NEW.execution_attempt
      AND attempt.job_version = NEW.job_version
      AND attempt.execution_evidence_hash = NEW.execution_evidence_hash
      AND attempt.status = 'GRANTED_PENDING_CONSUME'
      AND attempt.expires_at = NEW.authorization_expires_at
      AND attempt.expires_at > clock_timestamp()
      AND job.type = 'MANUAL_RANK_CHECK'
      AND job.version = NEW.job_version
      AND job.provider = NEW.provider
      AND job.credential_mode IN ('BYOK_API_KEY', 'PLATFORM_PAID')
      AND (
        (job.status = 'QUEUED' AND job.stage = 'WAITING_FOR_QUEUE')
        OR (job.status = 'RUNNING' AND job.stage = 'WAITING_EXECUTION_GRANT')
      )
      AND job.cancel_requested_at IS NULL
      AND run.seal_state = 'SEALED'
      AND run.estimate_id = NEW.estimate_id
      AND run.manifest_id = NEW.manifest_id
      AND run.manifest_hash = NEW.manifest_hash
      AND run.manifest_chunk_count BETWEEN 1 AND 300000
      AND NEW.manifest_chunk_index BETWEEN 0 AND run.manifest_chunk_count - 1
      AND run.finalization_status IS NULL
      AND item.sequence = NEW.manifest_chunk_index
      AND item.status = 'QUEUED'
      AND item.provider_request_id IS NULL
      AND item.output_reference IS NULL
      AND item.actual_cost_micro IS NULL
      AND item.error IS NULL
      AND item.attempt = 0
      AND item.retry_at IS NULL
      AND item.input_reference = jsonb_build_object(
        'schemaVersion', 'rank-job-item@1',
        'manifestId', NEW.manifest_id::text,
        'chunkIndex', NEW.manifest_chunk_index
      )
      AND estimate.provider = NEW.provider
      AND estimate.credential_mode = job.credential_mode
      AND estimate.execution_snapshot_hash = NEW.estimate_execution_hash
      AND estimate.binding_id = NEW.binding_id
      AND estimate.binding_version = NEW.binding_version
      AND estimate.route_id = NEW.route_id
      AND estimate.credential_id = NEW.credential_id
      AND estimate.credential_version <= NEW.credential_version
      AND estimate.credential_material_version = NEW.credential_material_version
      AND estimate.credential_validation_connector_version =
        NEW.credential_validation_connector_version
      AND estimate.credential_verified_at <= NEW.credential_verified_at
      AND estimate.provider_policy_version = NEW.provider_policy_version
      AND credential.provider = NEW.provider
      AND credential.mode = job.credential_mode
      AND credential.status = 'ACTIVE'
      AND credential.deleted_at IS NULL
      AND credential.version = NEW.credential_version
      AND credential.material_version = NEW.credential_material_version
      AND credential.verified_at = NEW.credential_verified_at
      AND validation.type = 'INTEGRATION_CREDENTIAL_VALIDATE'
      AND validation.provider = NEW.provider
      AND validation.credential_mode = job.credential_mode
      AND validation.status = 'COMPLETED'
      AND validation.version = NEW.credential_validation_version
      AND date_trunc('milliseconds', validation.finished_at) =
        NEW.credential_verified_at
      AND validation.finished_at <= clock_timestamp()
      AND validation.finished_at >= clock_timestamp() - INTERVAL '24 hours'
      AND validation.deduplication_key =
        'integration-credential-validation:' || NEW.credential_id::text ||
        ':' || NEW.credential_material_version::text
      AND validation.input_snapshot = jsonb_build_object(
        'kind', 'integration.credential.validation.v1',
        'credentialId', NEW.credential_id::text,
        'credentialMaterialVersion', NEW.credential_material_version,
        'connectorVersion', NEW.credential_validation_connector_version
      )
      AND binding.capability = 'SERP_RANK_TRACKING'
      AND binding.enabled
      AND binding.version = NEW.binding_version

      AND route.source_kind = 'WORKSPACE_CREDENTIAL'
      AND route.retired_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Rank connector execution must match one current granted Job graph'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.authorize_rank_connector_execution_submit(p_workspace_id uuid, p_execution_id uuid, p_lease_owner text, p_lease_token uuid, p_lease_generation integer, p_expected_version integer, p_execution_connector_version text)
 RETURNS TABLE("executionId" uuid, "workspaceId" uuid, "jobId" uuid, "jobItemId" uuid, "leaseGeneration" integer, "executionVersion" integer, "submitAttemptCount" integer, "submitBytesStartedAt" timestamp with time zone, "authorizationExpiresAt" timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
    AND job."provider" = candidate."provider"
    AND job."credential_mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
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
    AND run."manifest_chunk_count" BETWEEN 1 AND 300000
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
    AND credential."provider" = candidate."provider"
    AND credential."mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
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
    AND validation."provider" = candidate."provider"
    AND validation."credential_mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
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
  WHERE control."provider" = current_execution."provider"
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
    OR NOT (current_control."provider_policy_version" = current_execution."provider_policy_version" OR (current_control."provider_policy_version" = 'manual-arsenkin-positions@2.0.0' AND current_execution."provider_policy_version" = 'manual-arsenkin-positions@3.0.0') OR (current_control."provider_policy_version" = 'manual-xmlstock-serp@1.0.0' AND current_execution."provider_policy_version" = 'manual-xmlstock-serp@2.0.0') OR (current_control."provider_policy_version" = 'manual-arsenkin-positions@3.0.0' AND current_execution."provider_policy_version" IN ('manual-arsenkin-positions@1.0.0', 'manual-arsenkin-positions@2.0.0')) OR (current_control."provider_policy_version" = 'manual-xmlstock-serp@2.0.0' AND current_execution."provider_policy_version" = 'manual-xmlstock-serp@1.0.0'))
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
      AND job."provider" = current_execution."provider"
      AND job."credential_mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
      AND job."status" = 'RUNNING'
      AND job."stage" = 'WAITING_EXECUTION_GRANT'
      AND job."version" = current_execution."job_version"
      AND job."cancel_requested_at" IS NULL
      AND run."estimate_id" = current_execution."estimate_id"
      AND run."seal_state" = 'SEALED'
      AND run."manifest_id" = current_execution."manifest_id"
      AND run."manifest_hash" = current_execution."manifest_hash"
      AND run."manifest_chunk_count" BETWEEN 1 AND 300000
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
      AND credential."provider" = current_execution."provider"
      AND credential."mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
      AND credential."status" = 'ACTIVE'
      AND credential."deleted_at" IS NULL
      AND credential."version" = current_execution."credential_version"
      AND credential."material_version" =
        current_execution."credential_material_version"
      AND credential."verified_at" =
        current_execution."credential_verified_at"
      AND validation."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
      AND validation."provider" = current_execution."provider"
      AND validation."credential_mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_rank_connector_execution_pre_authorization(p_lease_owner text, p_lease_seconds integer, p_execution_connector_version text)
 RETURNS TABLE("executionId" uuid, "leaseToken" uuid, "leaseExpiresAt" timestamp with time zone, "workspaceId" uuid, provider character varying, "credentialId" uuid, "credentialMaterialVersion" integer, ciphertext bytea, nonce bytea, "authTag" bytea, "encryptedDataKey" bytea, "dataKeyNonce" bytea, "dataKeyAuthTag" bytea, "keyVersion" integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  candidate public.rank_connector_executions%ROWTYPE;
  current_execution public.rank_connector_executions%ROWTYPE;
  current_credential public.integration_credentials%ROWTYPE;
  current_control public.rank_connector_execution_controls%ROWTYPE;
  v_claimed_at TIMESTAMPTZ;
  v_claimed_lease_token UUID;
  v_claimed_lease_expires_at TIMESTAMPTZ;
BEGIN
  IF p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
  THEN
    RAISE EXCEPTION 'Invalid rank connector lease owner'
      USING ERRCODE = '22023';
  END IF;

  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 120 THEN
    RAISE EXCEPTION 'Rank connector lease must be between 5 and 120 seconds'
      USING ERRCODE = '22023';
  END IF;

  IF p_execution_connector_version IS NULL
    OR p_execution_connector_version !~
      '^[a-z0-9][a-z0-9@._-]{0,63}$'
  THEN
    RAISE EXCEPTION 'Invalid rank execution connector version'
      USING ERRCODE = '22023';
  END IF;

  -- Candidate discovery does not lock a child row first. Only the parent Job
  -- is claimed here; the remaining graph follows the canonical lock order.
  /* rank-connector-claim:job */
  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution
  JOIN public.jobs job
    ON job."workspace_id" = execution."workspace_id"
    AND job."project_id" = execution."project_id"
    AND job."id" = execution."job_id"
  JOIN public.rank_connector_execution_controls control
    ON control."provider" = job."provider"
    AND control."capability" = 'SERP_RANK_TRACKING'
  JOIN public.rank_job_runs run
    ON run."workspace_id" = execution."workspace_id"
    AND run."project_id" = execution."project_id"
    AND run."job_id" = execution."job_id"
  JOIN public.job_items item
    ON item."workspace_id" = execution."workspace_id"
    AND item."project_id" = execution."project_id"
    AND item."job_id" = execution."job_id"
    AND item."id" = execution."job_item_id"
  JOIN public.integration_credentials credential
    ON credential."workspace_id" = execution."workspace_id"
    AND credential."id" = execution."credential_id"
  JOIN public.jobs validation
    ON validation."workspace_id" = execution."workspace_id"
    AND validation."id" = execution."credential_validation_id"
  JOIN public.project_connector_bindings binding
    ON binding."workspace_id" = execution."workspace_id"
    AND binding."project_id" = execution."project_id"
    AND binding."id" = execution."binding_id"
  JOIN public.project_connector_routes route
    ON route."workspace_id" = execution."workspace_id"
    AND route."project_id" = execution."project_id"
    AND route."binding_id" = execution."binding_id"
    AND route."id" = execution."route_id"
    AND route."credential_id" = execution."credential_id"
  JOIN public.rank_execution_grant_attempts grant_attempt
    ON grant_attempt."id" = execution."grant_attempt_id"
    AND grant_attempt."workspace_id" = execution."workspace_id"
    AND grant_attempt."project_id" = execution."project_id"
    AND grant_attempt."job_id" = execution."job_id"
    AND grant_attempt."job_item_id" = execution."job_item_id"
  WHERE control."submit_enabled"
    AND control."execution_connector_version" =
      p_execution_connector_version
    AND control."execution_connector_version" =
      execution."execution_connector_version"
    AND (control."provider_policy_version" = execution."provider_policy_version" OR (control."provider_policy_version" = 'manual-arsenkin-positions@2.0.0' AND execution."provider_policy_version" = 'manual-arsenkin-positions@3.0.0') OR (control."provider_policy_version" = 'manual-xmlstock-serp@1.0.0' AND execution."provider_policy_version" = 'manual-xmlstock-serp@2.0.0') OR (control."provider_policy_version" = 'manual-arsenkin-positions@3.0.0' AND execution."provider_policy_version" IN ('manual-arsenkin-positions@1.0.0', 'manual-arsenkin-positions@2.0.0')) OR (control."provider_policy_version" = 'manual-xmlstock-serp@2.0.0' AND execution."provider_policy_version" = 'manual-xmlstock-serp@1.0.0'))
    AND control."kill_switch_version" =
      execution."kill_switch_version"
    AND job."type" = 'MANUAL_RANK_CHECK'
    AND job."provider" = execution."provider"
    AND job."credential_mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
    AND job."version" = execution."job_version"
    AND (
      (
        job."status" = 'QUEUED'
        AND job."stage" = 'WAITING_FOR_QUEUE'
      )
      OR
      (
        job."status" = 'RUNNING'
        AND job."stage" = 'WAITING_EXECUTION_GRANT'
      )
    )
    AND job."cancel_requested_at" IS NULL
    AND run."estimate_id" = execution."estimate_id"
    AND run."seal_state" = 'SEALED'
    AND run."manifest_id" = execution."manifest_id"
    AND run."manifest_hash" = execution."manifest_hash"
    AND run."manifest_chunk_count" BETWEEN 1 AND 300000
    AND execution."manifest_chunk_index" < run."manifest_chunk_count"
    AND run."finalization_status" IS NULL
    AND item."sequence" = execution."manifest_chunk_index"
    AND item."status" = 'QUEUED'
    AND item."provider_request_id" IS NULL
    AND item."output_reference" IS NULL
    AND item."actual_cost_micro" IS NULL
    AND item."error" IS NULL
    AND item."attempt" = 0
    AND item."retry_at" IS NULL
    AND item."input_reference" = jsonb_build_object(
      'schemaVersion', 'rank-job-item@1',
      'manifestId', execution."manifest_id"::text,
      'chunkIndex', execution."manifest_chunk_index"
    )
    AND credential."provider" = execution."provider"
    AND credential."mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
    AND credential."status" = 'ACTIVE'
    AND credential."deleted_at" IS NULL
    AND credential."version" = execution."credential_version"
    AND credential."material_version" =
      execution."credential_material_version"
    AND credential."verified_at" = execution."credential_verified_at"
    AND validation."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
    AND validation."provider" = execution."provider"
    AND validation."credential_mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
    AND validation."status" = 'COMPLETED'
    AND validation."version" =
      execution."credential_validation_version"
    AND validation."input_snapshot" = jsonb_build_object(
      'kind', 'integration.credential.validation.v1',
      'credentialId', execution."credential_id"::text,
      'credentialMaterialVersion',
        execution."credential_material_version",
      'connectorVersion',
        execution."credential_validation_connector_version"
    )
    AND binding."capability" = 'SERP_RANK_TRACKING'
    AND binding."enabled"
    AND binding."version" = execution."binding_version"

    AND route."source_kind" = 'WORKSPACE_CREDENTIAL'
    AND grant_attempt."execution_attempt" =
      execution."execution_attempt"
    AND grant_attempt."job_version" = execution."job_version"
    AND grant_attempt."execution_evidence_hash" =
      execution."execution_evidence_hash"
    AND grant_attempt."status" = 'CONSUMED'
    AND grant_attempt."expires_at" =
      execution."authorization_expires_at"
    AND execution."authorization_expires_at" >
      clock_timestamp() + make_interval(secs => p_lease_seconds)
    AND (
      execution."status" = 'READY_TO_SUBMIT'
      OR (
        execution."status" = 'CLAIMED'
        AND execution."lease_expires_at" <= clock_timestamp()
      )
    )
  ORDER BY (
    SELECT COUNT(*)
    FROM public.rank_connector_executions active_execution
    WHERE active_execution."credential_id" = execution."credential_id"
      AND active_execution."project_id" = execution."project_id"
      AND active_execution."provider" = execution."provider"
      AND (
        active_execution."status" = 'SUBMITTING'
        OR (
          active_execution."status" IN ('CLAIMED', 'FETCHING')
          AND active_execution."lease_expires_at" > clock_timestamp()
        )
      )
  ), execution."created_at", execution."id"
  FOR UPDATE OF job SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  /* rank-connector-claim:run */
  PERFORM 1
  FROM public.rank_job_runs run
  WHERE run."workspace_id" = candidate."workspace_id"
    AND run."project_id" = candidate."project_id"
    AND run."job_id" = candidate."job_id"
    AND run."estimate_id" = candidate."estimate_id"
    AND run."seal_state" = 'SEALED'
    AND run."manifest_id" = candidate."manifest_id"
    AND run."manifest_hash" = candidate."manifest_hash"
    AND run."manifest_chunk_count" BETWEEN 1 AND 300000
    AND candidate."manifest_chunk_index" < run."manifest_chunk_count"
    AND run."finalization_status" IS NULL
  FOR UPDATE OF run;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:item */
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

  /* rank-connector-claim:credential */
  SELECT credential.*
  INTO current_credential
  FROM public.integration_credentials credential
  WHERE credential."workspace_id" = candidate."workspace_id"
    AND credential."id" = candidate."credential_id"
    AND credential."provider" = candidate."provider"
    AND credential."mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
    AND credential."status" = 'ACTIVE'
    AND credential."deleted_at" IS NULL
    AND credential."version" = candidate."credential_version"
    AND credential."material_version" =
      candidate."credential_material_version"
    AND credential."verified_at" = candidate."credential_verified_at"
  FOR UPDATE OF credential;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:validation */
  PERFORM 1
  FROM public.jobs validation
  WHERE validation."workspace_id" = candidate."workspace_id"
    AND validation."id" = candidate."credential_validation_id"
    AND validation."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
    AND validation."provider" = candidate."provider"
    AND validation."credential_mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
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

  /* rank-connector-claim:binding */
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

  /* rank-connector-claim:route */
  PERFORM 1
  FROM public.project_connector_routes route
  WHERE route."workspace_id" = candidate."workspace_id"
    AND route."project_id" = candidate."project_id"
    AND route."binding_id" = candidate."binding_id"
    AND route."id" = candidate."route_id"
    AND route."credential_id" = candidate."credential_id"

    AND route."source_kind" = 'WORKSPACE_CREDENTIAL'
  FOR UPDATE OF route;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:grant */
  PERFORM 1
  FROM public.rank_execution_grant_attempts grant_attempt
  WHERE grant_attempt."id" = candidate."grant_attempt_id"
    AND grant_attempt."workspace_id" = candidate."workspace_id"
    AND grant_attempt."project_id" = candidate."project_id"
    AND grant_attempt."job_id" = candidate."job_id"
    AND grant_attempt."job_item_id" = candidate."job_item_id"
    AND grant_attempt."execution_attempt" =
      candidate."execution_attempt"
    AND grant_attempt."job_version" = candidate."job_version"
    AND grant_attempt."execution_evidence_hash" =
      candidate."execution_evidence_hash"
    AND grant_attempt."status" = 'CONSUMED'
    AND grant_attempt."expires_at" =
      candidate."authorization_expires_at"
  FOR UPDATE OF grant_attempt;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:execution */
  SELECT execution.*
  INTO current_execution
  FROM public.rank_connector_executions execution
  WHERE execution."id" = candidate."id"
    AND execution."version" = candidate."version"
  FOR UPDATE OF execution;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:control */
  SELECT control.*
  INTO current_control
  FROM public.rank_connector_execution_controls control
  WHERE control."provider" = current_execution."provider"
    AND control."capability" = 'SERP_RANK_TRACKING'
  FOR SHARE OF control;
  IF NOT FOUND THEN RETURN; END IF;

  -- All potentially blocking locks are held. Re-read clock, execution state,
  -- exact control versions and the authoritative Job lifecycle before claim.
  v_claimed_at := clock_timestamp();
  v_claimed_lease_expires_at :=
    v_claimed_at + make_interval(secs => p_lease_seconds);

  IF NOT current_control."submit_enabled"
    OR current_control."execution_connector_version" <>
      p_execution_connector_version
    OR current_control."execution_connector_version" <>
      current_execution."execution_connector_version"
    OR NOT (current_control."provider_policy_version" = current_execution."provider_policy_version" OR (current_control."provider_policy_version" = 'manual-arsenkin-positions@2.0.0' AND current_execution."provider_policy_version" = 'manual-arsenkin-positions@3.0.0') OR (current_control."provider_policy_version" = 'manual-xmlstock-serp@1.0.0' AND current_execution."provider_policy_version" = 'manual-xmlstock-serp@2.0.0') OR (current_control."provider_policy_version" = 'manual-arsenkin-positions@3.0.0' AND current_execution."provider_policy_version" IN ('manual-arsenkin-positions@1.0.0', 'manual-arsenkin-positions@2.0.0')) OR (current_control."provider_policy_version" = 'manual-xmlstock-serp@2.0.0' AND current_execution."provider_policy_version" = 'manual-xmlstock-serp@1.0.0'))
    OR current_control."kill_switch_version" <>
      current_execution."kill_switch_version"
    OR current_execution."authorization_expires_at" <=
      v_claimed_lease_expires_at
    OR NOT (
      current_execution."status" = 'READY_TO_SUBMIT'
      OR (
        current_execution."status" = 'CLAIMED'
        AND current_execution."lease_expires_at" <= v_claimed_at
      )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.jobs job
      WHERE job."workspace_id" = current_execution."workspace_id"
        AND job."project_id" = current_execution."project_id"
        AND job."id" = current_execution."job_id"
        AND job."type" = 'MANUAL_RANK_CHECK'
        AND job."provider" = current_execution."provider"
        AND job."credential_mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
        AND job."version" = current_execution."job_version"
        AND (
          (
            job."status" = 'QUEUED'
            AND job."stage" = 'WAITING_FOR_QUEUE'
          )
          OR
          (
            job."status" = 'RUNNING'
            AND job."stage" = 'WAITING_EXECUTION_GRANT'
          )
        )
        AND job."cancel_requested_at" IS NULL
    )
  THEN
    RETURN;
  END IF;

  v_claimed_lease_token := pg_catalog.uuidv7();

  UPDATE public.rank_connector_executions execution
  SET
    "status" = 'CLAIMED',
    "lease_owner" = p_lease_owner,
    "lease_token" = v_claimed_lease_token,
    "lease_expires_at" = v_claimed_lease_expires_at,
    "claimed_at" = v_claimed_at,
    "version" = execution."version" + 1,
    "updated_at" = v_claimed_at
  WHERE execution."id" = current_execution."id"
    AND execution."version" = current_execution."version";

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- CLAIMED is intentionally pre-network. A future authorize/SUBMITTING
  -- operation must re-check this lease and control before any provider bytes.
  RETURN QUERY
  SELECT
    current_execution."id",
    v_claimed_lease_token,
    v_claimed_lease_expires_at,
    current_credential."workspace_id",
    current_credential."provider",
    current_credential."id",
    current_credential."material_version",
    current_credential."ciphertext",
    current_credential."nonce",
    current_credential."auth_tag",
    current_credential."encrypted_data_key",
    current_credential."data_key_nonce",
    current_credential."data_key_auth_tag",
    current_credential."key_version";
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_rank_connector_poll(p_lease_owner text, p_lease_seconds integer, p_execution_connector_version text)
 RETURNS TABLE("executionId" uuid, "leaseToken" uuid, "leaseExpiresAt" timestamp with time zone, "workspaceId" uuid, provider character varying, "credentialId" uuid, "credentialMaterialVersion" integer, ciphertext bytea, nonce bytea, "authTag" bytea, "encryptedDataKey" bytea, "dataKeyNonce" bytea, "dataKeyAuthTag" bytea, "keyVersion" integer, "providerTaskId" text, "requestSnapshot" jsonb, "providerProgressSnapshot" jsonb, "providerProgressHash" bytea, "leaseGeneration" integer, "executionVersion" integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  candidate public.rank_connector_executions%ROWTYPE;
  v_now TIMESTAMPTZ;
  v_token UUID;
  v_expiry TIMESTAMPTZ;
BEGIN
  IF p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
    OR p_lease_seconds NOT BETWEEN 5 AND 120
    OR p_execution_connector_version IS NULL
    OR p_execution_connector_version !~ '^[a-z0-9][a-z0-9@._-]{0,63}$'
  THEN
    RAISE EXCEPTION 'Invalid rank connector poll claim'
      USING ERRCODE = '22023';
  END IF;


  -- A worker that lost its lease on the fiftieth request must become terminal
  -- without issuing request 51.  This also recovers maxed POLL_WAIT rows left
  -- by an older worker version.
  UPDATE public.rank_connector_executions execution
  SET status = 'FAILED_FINAL',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      claimed_at = NULL,
      next_action_at = NULL,
      provider_progress_snapshot = NULL,
      provider_progress_hash = NULL,
      observed_at = NULL,
      normalized_result_snapshot = NULL,
      normalized_result_hash = NULL,
      last_error_code = COALESCE(
        execution.last_error_code,
        'PROVIDER_POLL_TIMEOUT'
      ),
      finished_at = clock_timestamp(),
      version = execution.version + 1,
      updated_at = clock_timestamp()
  FROM public.jobs job
  WHERE job.workspace_id = execution.workspace_id
    AND job.project_id = execution.project_id
    AND job.id = execution.job_id
    AND job.type = 'MANUAL_RANK_CHECK'
    AND job.status = 'RUNNING'
    AND job.stage = 'WAITING_EXECUTION_GRANT'
    AND execution.provider = 'XMLSTOCK'
    AND execution.poll_attempt_count >= 50
    AND (
      execution.status = 'POLL_WAIT'
      OR (
        execution.status = 'FETCHING'
        AND execution.lease_expires_at <= clock_timestamp()
      )
    );

  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution
  JOIN public.jobs job
    ON job.workspace_id = execution.workspace_id
    AND job.project_id = execution.project_id
    AND job.id = execution.job_id
  JOIN public.rank_connector_execution_controls control
    ON control.provider = execution.provider
    AND control.capability = 'SERP_RANK_TRACKING'
  JOIN public.integration_credentials credential
    ON credential.workspace_id = execution.workspace_id
    AND credential.id = execution.credential_id
  WHERE execution.execution_connector_version = p_execution_connector_version
    AND control.execution_connector_version = p_execution_connector_version
    AND (control.provider_policy_version = execution.provider_policy_version OR (control.provider_policy_version = 'manual-arsenkin-positions@2.0.0' AND execution.provider_policy_version = 'manual-arsenkin-positions@3.0.0') OR (control.provider_policy_version = 'manual-xmlstock-serp@1.0.0' AND execution.provider_policy_version = 'manual-xmlstock-serp@2.0.0') OR (control.provider_policy_version = 'manual-arsenkin-positions@3.0.0' AND execution.provider_policy_version IN ('manual-arsenkin-positions@1.0.0', 'manual-arsenkin-positions@2.0.0')) OR (control.provider_policy_version = 'manual-xmlstock-serp@2.0.0' AND execution.provider_policy_version = 'manual-xmlstock-serp@1.0.0'))
    AND control.kill_switch_version = execution.kill_switch_version
    AND job.type = 'MANUAL_RANK_CHECK'
    AND job.provider = execution.provider
    AND job.status = 'RUNNING'
    AND job.stage = 'WAITING_EXECUTION_GRANT'
    AND job.version = execution.job_version
    AND credential.provider = execution.provider
    AND credential.material_version = execution.credential_material_version
    AND credential.ciphertext IS NOT NULL
    AND execution.poll_attempt_count <
      CASE WHEN execution.provider = 'XMLSTOCK' THEN 50 ELSE 720 END
    AND (
      (execution.status = 'POLL_WAIT' AND execution.next_action_at <= clock_timestamp())
      OR (execution.status = 'FETCHING' AND execution.lease_expires_at <= clock_timestamp())
    )
  ORDER BY (
    SELECT COUNT(*)
    FROM public.rank_connector_executions active_execution
    WHERE active_execution.credential_id = execution.credential_id
      AND active_execution.project_id = execution.project_id
      AND active_execution.provider = execution.provider
      AND active_execution.status = 'FETCHING'
      AND active_execution.lease_expires_at > clock_timestamp()
  ), execution.next_action_at NULLS FIRST, execution.created_at, execution.id
  FOR UPDATE OF execution SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  v_now := clock_timestamp();
  v_token := pg_catalog.uuidv7();
  v_expiry := v_now + make_interval(secs => p_lease_seconds);

  UPDATE public.rank_connector_executions execution
  SET status = 'FETCHING',
      lease_owner = p_lease_owner,
      lease_token = v_token,
      lease_expires_at = v_expiry,
      claimed_at = v_now,
      poll_attempt_count = execution.poll_attempt_count + 1,
      next_action_at = NULL,
      version = execution.version + 1,
      updated_at = v_now
  WHERE execution.id = candidate.id
    AND execution.version = candidate.version;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT execution.id,
         v_token,
         v_expiry,
         credential.workspace_id,
         execution.provider,
         credential.id,
         credential.material_version,
         credential.ciphertext,
         credential.nonce,
         credential.auth_tag,
         credential.encrypted_data_key,
         credential.data_key_nonce,
         credential.data_key_auth_tag,
         credential.key_version,
         execution.provider_task_id::TEXT,
         intent.request_snapshot,
         execution.provider_progress_snapshot,
         execution.provider_progress_hash,
         execution.lease_generation,
         execution.version
  FROM public.rank_connector_executions execution
  JOIN public.integration_credentials credential
    ON credential.workspace_id = execution.workspace_id
    AND credential.id = execution.credential_id
    AND credential.provider = execution.provider
  JOIN public.rank_provider_request_intents intent
    ON intent.id = execution.provider_request_intent_id
    AND intent.workspace_id = execution.workspace_id
    AND intent.request_hash = execution.provider_request_intent_hash
  WHERE execution.id = candidate.id
    AND execution.lease_token = v_token
    AND execution.status = 'FETCHING';
END
$function$;

CREATE OR REPLACE FUNCTION public.rank_execution_grant_request_is_exact(p_snapshot jsonb, p_workspace_id uuid, p_project_id uuid, p_job_id uuid, p_job_item_id uuid, p_job_version integer, p_execution_attempt integer, p_execution_evidence_hash bytea)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
      'provider', p_snapshot ->> 'provider',
      'operation', 'POSITIONS',
      'capability', 'SERP_RANK_TRACKING',
      'credentialMode', p_snapshot ->> 'credentialMode',
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
    AND manifest_chunk_index BETWEEN 0 AND 299999
    AND (p_snapshot ->> 'provider') IN ('ARSENKIN', 'XMLSTOCK')
    AND (p_snapshot ->> 'credentialMode') IN ('BYOK_API_KEY', 'PLATFORM_PAID')
    AND (p_snapshot ->> 'policyVersion') ~
      '^[a-z0-9][a-z0-9@._-]{0,63}$';
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END
$function$;

-- Batch policy v3 (Arsenkin) / v2 (XMLStock) reuses the certified wire
-- contract of the preceding control policy. Compatibility is explicit above.
-- Do not mutate the control row: its version/kill-switch history is immutable,
-- and changing the generation would revoke already admitted legacy tasks.
-- submit_enabled, connector version, validation and every lease/kill-switch
-- comparison remain mandatory. No control history or existing job is rewritten.
COMMIT;
