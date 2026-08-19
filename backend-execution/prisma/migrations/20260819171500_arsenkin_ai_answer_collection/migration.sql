BEGIN;

-- Existing verified Arsenkin credentials already use the same API key and
-- account for ai-serp. Make the newly exposed capability routable without
-- forcing every workspace owner to reconnect the provider.
UPDATE public.integration_credentials
SET capabilities = capabilities || '["SERP_COLLECTION"]'::jsonb,
    version = version + 1,
    updated_at = clock_timestamp()
WHERE provider = 'ARSENKIN'
  AND deleted_at IS NULL
  AND jsonb_typeof(capabilities) = 'array'
  AND NOT capabilities ? 'SERP_COLLECTION';

-- Rank, Wordstat and AI answer checks consume the same five durable Arsenkin
-- provider-task slots. Extend the two existing fenced capacity checks without
-- changing which job type each function is allowed to mutate.
DO $migration$
DECLARE
  function_signature TEXT;
  function_definition TEXT;
  old_fragment TEXT;
  new_fragment TEXT;
  occurrence_count INTEGER;
BEGIN
  function_signature :=
    'public.mark_frequency_collection_batch_submitting(uuid,uuid[],text,integer,text,integer)';
  SELECT pg_get_functiondef(function_signature::regprocedure)
  INTO function_definition;
  old_fragment := 'AND frequency_job.type = ''FREQUENCY_COLLECTION''';
  new_fragment :=
    'AND frequency_job.type IN (''FREQUENCY_COLLECTION'', ''AI_ANSWER_COLLECTION'')';
  occurrence_count := (
    length(function_definition) - length(replace(function_definition, old_fragment, ''))
  ) / length(old_fragment);
  IF occurrence_count <> 1 THEN
    RAISE EXCEPTION 'unexpected Wordstat capacity job-type predicate';
  END IF;
  EXECUTE replace(function_definition, old_fragment, new_fragment);

  function_signature :=
    'public.claim_rank_connector_submit_bounded(text,integer,text)';
  SELECT pg_get_functiondef(function_signature::regprocedure)
  INTO function_definition;
  old_fragment := 'WHERE frequency_job.type = ''FREQUENCY_COLLECTION''';
  new_fragment :=
    'WHERE frequency_job.type IN (''FREQUENCY_COLLECTION'', ''AI_ANSWER_COLLECTION'')';
  occurrence_count := (
    length(function_definition) - length(replace(function_definition, old_fragment, ''))
  ) / length(old_fragment);
  IF occurrence_count <> 1 THEN
    RAISE EXCEPTION 'unexpected rank capacity job-type predicate';
  END IF;
  EXECUTE replace(function_definition, old_fragment, new_fragment);
END
$migration$;

COMMIT;
