BEGIN;

-- A single 15,000-keyword Arsenkin Positions task can legitimately run for
-- longer than the former 180 polls (~30 minutes at the default 10s delay).
-- Widen only the poll lifecycle horizon. Submit authorization, connector
-- version routing and provider concurrency claims deliberately stay intact.
DO $migration$
DECLARE
  shape_definition TEXT;
  guard_definition TEXT;
  claim_definition TEXT;
  complete_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO shape_definition
  FROM pg_constraint
  WHERE conrelid = 'public.rank_connector_executions'::regclass
    AND conname = 'rank_connector_executions_shape';

  IF shape_definition IS NULL
    OR length(shape_definition) -
      length(replace(shape_definition, '180', '')) <> 12
  THEN
    RAISE EXCEPTION
      'Unexpected rank connector shape before poll horizon migration'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE
    'ALTER TABLE public.rank_connector_executions ' ||
    'DROP CONSTRAINT "rank_connector_executions_shape"';
  EXECUTE
    'ALTER TABLE public.rank_connector_executions ' ||
    'ADD CONSTRAINT "rank_connector_executions_shape" ' ||
    replace(shape_definition, '180', '720') || ' NOT VALID';

  SELECT pg_get_functiondef(
    'public.assert_rank_connector_execution_claim_transition()'::regprocedure
  )
  INTO guard_definition;
  IF length(guard_definition) -
      length(replace(guard_definition, '180', '')) <> 3
  THEN
    RAISE EXCEPTION
      'Unexpected rank connector transition guard before poll horizon migration'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(guard_definition, '180', '720');

  SELECT pg_get_functiondef(
    'public.claim_rank_connector_poll(text,integer,text)'::regprocedure
  )
  INTO claim_definition;
  IF length(claim_definition) -
      length(replace(claim_definition, '180', '')) <> 3
  THEN
    RAISE EXCEPTION
      'Unexpected poll claim before poll horizon migration'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(claim_definition, '180', '720');

  SELECT pg_get_functiondef(
    'public.complete_rank_connector_poll(uuid,uuid,text,uuid,integer,integer,text,integer,timestamptz,jsonb,bytea,text)'::regprocedure
  )
  INTO complete_definition;
  IF length(complete_definition) -
      length(replace(complete_definition, '180', '')) <> 3
  THEN
    RAISE EXCEPTION
      'Unexpected poll completion before poll horizon migration'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(complete_definition, '180', '720');
END
$migration$;

ALTER TABLE public.rank_connector_executions
  VALIDATE CONSTRAINT "rank_connector_executions_shape";

COMMIT;
