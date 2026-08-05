BEGIN;

-- XMLStock explicitly recommends waiting 10-20 seconds before the first
-- delayed Yandex XML poll. Keep the existing Arsenkin cadence unchanged.
DO $migration$
DECLARE
  definition TEXT;
  old_expression CONSTANT TEXT :=
    'WHEN p_outcome = ''ACCEPTED'' THEN v_now + interval ''5 seconds''';
  new_expression CONSTANT TEXT :=
    'WHEN p_outcome = ''ACCEPTED'' THEN v_now + CASE WHEN execution.provider = ''XMLSTOCK'' THEN interval ''15 seconds'' ELSE interval ''5 seconds'' END';
BEGIN
  SELECT pg_get_functiondef(
    'public.complete_rank_connector_submit(uuid,uuid,text,uuid,integer,integer,text,text,jsonb,bytea,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL OR position(old_expression IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected rank connector submit cadence before XMLStock migration'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(definition, old_expression, new_expression);

  IF position(old_expression IN definition) > 0
    OR position(new_expression IN definition) = 0
  THEN
    RAISE EXCEPTION 'XMLStock rank connector submit cadence was not replaced safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

COMMIT;
