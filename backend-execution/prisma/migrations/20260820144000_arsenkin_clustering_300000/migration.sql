BEGIN;

-- Arsenkin accepts one clustering task with up to 300,000 queries. Keep every
-- fenced broker command on the same exact bound as the application contract.
DO $migration$
DECLARE
  routine_name TEXT;
  routine REGPROCEDURE;
  definition TEXT;
  old_limit CONSTANT TEXT := 'expected_count NOT BETWEEN 1 AND 10000';
  new_limit CONSTANT TEXT := 'expected_count NOT BETWEEN 1 AND 300000';
BEGIN
  FOREACH routine_name IN ARRAY ARRAY[
    'public.claim_clustering_run(text,integer)',
    'public.renew_clustering_run_lease(uuid,uuid[],text,integer,integer)',
    'public.mark_clustering_run_submitting(uuid,uuid[],text,integer,text,integer)',
    'public.transition_clustering_run(uuid,uuid[],text,integer,text,text,integer,text,jsonb)'
  ]
  LOOP
    routine := to_regprocedure(routine_name);
    IF routine IS NULL THEN
      RAISE EXCEPTION 'Missing clustering broker routine: %', routine_name
        USING ERRCODE = '55000';
    END IF;

    SELECT pg_get_functiondef(routine) INTO definition;
    IF definition IS NULL
      OR position(old_limit IN definition) = 0
      OR position(new_limit IN definition) > 0
    THEN
      RAISE EXCEPTION 'Unexpected clustering bound in routine: %', routine_name
        USING ERRCODE = '55000';
    END IF;

    definition := replace(definition, old_limit, new_limit);
    IF position(old_limit IN definition) > 0
      OR position(new_limit IN definition) = 0
    THEN
      RAISE EXCEPTION 'Clustering bound was not updated safely: %', routine_name
        USING ERRCODE = '55000';
    END IF;

    EXECUTE definition;
  END LOOP;
END
$migration$;

COMMIT;
