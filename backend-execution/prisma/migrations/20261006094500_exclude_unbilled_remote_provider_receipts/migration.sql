BEGIN;

-- A completed worker receipt is immutable evidence of what the provider said.
-- A known unbilled retryable provider rejection is not, however, a reusable
-- paid result. Keep the receipt intact and exclude only its cache lookup.
CREATE TABLE public.remote_work_replay_exclusions (
  task_id UUID PRIMARY KEY REFERENCES public.remote_work_tasks(id) ON DELETE CASCADE,
  reason VARCHAR(64) NOT NULL CHECK (reason IN ('PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.remote_work_replay_exclusions FROM PUBLIC;

CREATE FUNCTION public.exclude_remote_work_retryable_receipt(
  p_task_id UUID, p_read_token UUID, p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  receipt public.remote_work_tasks%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE') THEN
    RAISE EXCEPTION 'Invalid retryable provider receipt' USING ERRCODE = '22023';
  END IF;
  SELECT task.* INTO receipt FROM public.remote_work_tasks task
  WHERE task.id = p_task_id
    AND task.read_token_hash = sha256(convert_to(p_read_token::TEXT, 'UTF8'))
    AND task.state = 'COMPLETED'
    AND task.command = 'PROVIDER_HTTP'
    AND task.source_scope->>'provider' = 'XMLSTOCK'
    AND task.payload->>'url' LIKE 'https://xmlstock.com/wordstat/json/%'
    AND task.result->>'format' = 'HTTP'
    AND task.result->>'status' IN ('200', '429', '500', '501', '502', '503')
  FOR SHARE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  INSERT INTO public.remote_work_replay_exclusions(task_id, reason)
    VALUES (receipt.id, p_reason) ON CONFLICT (task_id) DO NOTHING;
  RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.exclude_remote_work_retryable_receipt(UUID, UUID, TEXT) FROM PUBLIC;

-- The admission cache must never replay a provider-confirmed unbilled error.
DO $$
DECLARE definition TEXT; updated TEXT;
BEGIN
  definition := pg_get_functiondef(
    'public.enqueue_remote_work(jsonb,text,text,text,jsonb,text,integer)'::REGPROCEDURE);
  updated := replace(definition,
    'AND t.command=''PROVIDER_HTTP'' AND t.state=''COMPLETED'' ORDER BY t.created_at DESC LIMIT 1;',
    'AND t.command=''PROVIDER_HTTP'' AND t.state=''COMPLETED''
      AND NOT EXISTS (SELECT 1 FROM public.remote_work_replay_exclusions excluded WHERE excluded.task_id = t.id)
      ORDER BY t.created_at DESC LIMIT 1;');
  IF updated = definition OR
     position('remote_work_replay_exclusions excluded' IN updated) = 0 THEN
    RAISE EXCEPTION 'Expected remote paid receipt lookup was not found';
  END IF;
  EXECUTE updated;
END $$;

COMMIT;
