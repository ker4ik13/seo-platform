BEGIN;

-- A long rank run may outlive the periodic validation attached to its
-- estimate. Accept a newer successful validation only when routing and secret
-- material are unchanged. The current credential and validation remain bound
-- to every immutable execution evidence row.
CREATE OR REPLACE FUNCTION public.assert_rank_connector_execution_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
      AND job.credential_mode = 'BYOK_API_KEY'
      AND (
        (job.status = 'QUEUED' AND job.stage = 'WAITING_FOR_QUEUE')
        OR (job.status = 'RUNNING' AND job.stage = 'WAITING_EXECUTION_GRANT')
      )
      AND job.cancel_requested_at IS NULL
      AND run.seal_state = 'SEALED'
      AND run.estimate_id = NEW.estimate_id
      AND run.manifest_id = NEW.manifest_id
      AND run.manifest_hash = NEW.manifest_hash
      AND run.manifest_chunk_count BETWEEN 1 AND 15000
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
      AND credential.mode = 'BYOK_API_KEY'
      AND credential.status = 'ACTIVE'
      AND credential.deleted_at IS NULL
      AND credential.version = NEW.credential_version
      AND credential.material_version = NEW.credential_material_version
      AND credential.verified_at = NEW.credential_verified_at
      AND validation.type = 'INTEGRATION_CREDENTIAL_VALIDATE'
      AND validation.provider = NEW.provider
      AND validation.status = 'COMPLETED'
      AND validation.version = NEW.credential_validation_version
      AND validation.finished_at = NEW.credential_verified_at
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
      AND route.position = 0
      AND route.source_kind = 'WORKSPACE_CREDENTIAL'
      AND route.retired_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Rank connector execution must match one current granted Job graph'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

COMMIT;
