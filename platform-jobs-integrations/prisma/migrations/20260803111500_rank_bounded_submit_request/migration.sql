BEGIN;

-- A sealed XMLStock manifest may be dispatched in bounded windows. Reading
-- the immutable request for the currently claimed execution must therefore
-- validate that execution, not require executions for every later manifest
-- item to have been pre-authorized already.
CREATE OR REPLACE FUNCTION public.read_rank_connector_submit_request(
  p_workspace_id UUID,
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_lease_generation INTEGER,
  p_expected_version INTEGER
)
RETURNS TABLE (
  "executionId" UUID,
  "workspaceId" UUID,
  "requestSnapshot" JSONB,
  "requestHash" BYTEA
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    execution."id",
    execution."workspace_id",
    intent."request_snapshot",
    intent."request_hash"
  FROM public.rank_connector_executions execution
  JOIN public.rank_provider_request_intents intent
    ON intent."workspace_id" = execution."workspace_id"
    AND intent."project_id" = execution."project_id"
    AND intent."job_id" = execution."job_id"
    AND intent."job_item_id" = execution."job_item_id"
    AND intent."id" = execution."provider_request_intent_id"
    AND intent."request_hash" =
      execution."provider_request_intent_hash"
    AND intent."manifest_id" = execution."manifest_id"
    AND intent."manifest_hash" = execution."manifest_hash"
    AND intent."manifest_chunk_index" =
      execution."manifest_chunk_index"
    AND intent."manifest_chunk_hash" =
      execution."provider_request_intent_chunk_hash"
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."id" = p_execution_id
    AND execution."status" = 'CLAIMED'
    AND execution."lease_owner" = p_lease_owner
    AND execution."lease_token" = p_lease_token
    AND execution."lease_generation" = p_lease_generation
    AND execution."version" = p_expected_version
    AND execution."lease_expires_at" > clock_timestamp()
    AND execution."authorization_expires_at" > clock_timestamp()
$$;

REVOKE ALL ON FUNCTION
  public.read_rank_connector_submit_request(
    UUID, UUID, TEXT, UUID, INTEGER, INTEGER
  )
  FROM PUBLIC;

COMMIT;
