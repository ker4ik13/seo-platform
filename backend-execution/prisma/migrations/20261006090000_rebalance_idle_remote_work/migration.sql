BEGIN;

-- A healthy node can become busy after the first task of an operation. Keep
-- its current fenced work, but choose the least-loaded eligible node again
-- when no task from that operation/capability is still outstanding.
DO $$
DECLARE
  signature REGPROCEDURE := 'public.enqueue_remote_work(jsonb,text,text,text,jsonb,text,integer)'::REGPROCEDURE;
  definition TEXT;
  updated TEXT;
BEGIN
  definition := pg_get_functiondef(signature);
  updated := replace(
    definition,
    'AND public.remote_worker_capability_capacity(n,p_capability)>0;',
    'AND public.remote_worker_capability_capacity(n,p_capability)>0
      AND EXISTS (
        SELECT 1 FROM public.remote_work_tasks active
        WHERE active.operation_id = v_operation
          AND active.capability = p_capability
          AND active.state IN (''PENDING'', ''CLAIMED'')
          AND active.execution_deadline > clock_timestamp()
      );'
  );
  IF updated = definition OR
     position('active.execution_deadline > clock_timestamp()' IN updated) = 0 THEN
    RAISE EXCEPTION 'Expected remote work assignment boundary was not found';
  END IF;
  EXECUTE updated;
END $$;

COMMIT;
