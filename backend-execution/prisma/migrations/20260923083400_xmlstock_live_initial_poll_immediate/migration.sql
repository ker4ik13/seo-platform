BEGIN;

-- XMLStock Yandex Search API is asynchronous and needs the documented pause
-- before its first status poll. Live Yandex and Google are synchronous page
-- GETs, so delaying their first page by 15 seconds only wastes free capacity.
DO $migration$
DECLARE
  definition TEXT;
  old_expression CONSTANT TEXT :=
    'WHEN p_outcome = ''ACCEPTED'' THEN v_now + CASE WHEN execution.provider = ''XMLSTOCK'' THEN interval ''15 seconds'' ELSE interval ''5 seconds'' END';
  new_expression CONSTANT TEXT :=
    'WHEN p_outcome = ''ACCEPTED'' THEN v_now + CASE WHEN execution.provider <> ''XMLSTOCK'' THEN interval ''5 seconds'' WHEN p_wire_request_snapshot->>''delayed'' = ''true'' THEN interval ''15 seconds'' ELSE interval ''0 seconds'' END';
BEGIN
  SELECT pg_get_functiondef(
    'public.complete_rank_connector_submit(uuid,uuid,text,uuid,integer,integer,text,text,jsonb,bytea,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_expression, '')))
      / length(old_expression) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected rank connector submit cadence before Live immediate-poll migration'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(definition, old_expression, new_expression);
END
$migration$;

REVOKE ALL ON FUNCTION public.complete_rank_connector_submit(
  UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT, JSONB, BYTEA, TEXT
) FROM PUBLIC;

COMMIT;
