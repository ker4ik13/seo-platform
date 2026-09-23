-- Expired FETCHING leases use their own small partial index so recovery does
-- not scan the immutable history of completed connector executions.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  rank_connector_executions_job_fetching_due_idx
ON public.rank_connector_executions (
  job_id,
  execution_connector_version,
  lease_expires_at,
  poll_attempt_count,
  created_at,
  id
)
WHERE status = 'FETCHING';
