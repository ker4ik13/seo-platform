-- Keep only live poll rows in this index. Its size follows active provider
-- work instead of the append-only connector execution history.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  rank_connector_executions_job_poll_wait_due_idx
ON public.rank_connector_executions (
  job_id,
  execution_connector_version,
  next_action_at,
  poll_attempt_count,
  created_at,
  id
)
WHERE status = 'POLL_WAIT';
