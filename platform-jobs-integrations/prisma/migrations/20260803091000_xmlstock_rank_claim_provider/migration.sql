BEGIN;

-- The XMLStock rank runtime originally generalized the public claim wrapper.
-- Submit authorization later moved the real graph checks into the renamed
-- pre-authorization primitive, so that function retained Arsenkin-only
-- predicates and silently returned no XMLStock claim. Generalize the actual
-- primitive while preserving its lock order, leases and fail-closed graph.
DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution_pre_authorization(text,integer,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, 'ARSENKIN', ''))) / length('ARSENKIN') <> 7
    OR (length(definition) - length(replace(definition, 'BETWEEN 1 AND 4', ''))) / length('BETWEEN 1 AND 4') <> 2
    OR position('BETWEEN 5 AND 120' IN definition) = 0
  THEN
    RAISE EXCEPTION 'Unexpected rank pre-authorization function before XMLStock claim migration'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(definition, 'BETWEEN 1 AND 4', 'BETWEEN 1 AND 15000');

  -- Candidate discovery uses the execution alias.
  definition := regexp_replace(
    definition,
    'job\."provider" = ''ARSENKIN''',
    'job."provider" = execution."provider"'
  );
  definition := regexp_replace(
    definition,
    'credential\."provider" = ''ARSENKIN''',
    'credential."provider" = execution."provider"'
  );
  definition := regexp_replace(
    definition,
    'validation\."provider" = ''ARSENKIN''',
    'validation."provider" = execution."provider"'
  );

  -- Locked graph rechecks use the selected candidate/current execution.
  definition := regexp_replace(
    definition,
    'credential\."provider" = ''ARSENKIN''',
    'credential."provider" = candidate."provider"'
  );
  definition := regexp_replace(
    definition,
    'validation\."provider" = ''ARSENKIN''',
    'validation."provider" = candidate."provider"'
  );
  definition := regexp_replace(
    definition,
    'control\."provider" = ''ARSENKIN''',
    'control."provider" = current_execution."provider"'
  );
  definition := regexp_replace(
    definition,
    'job\."provider" = ''ARSENKIN''',
    'job."provider" = current_execution."provider"'
  );

  IF position('ARSENKIN' IN definition) > 0
    OR position('BETWEEN 1 AND 4' IN definition) > 0
    OR position('BETWEEN 1 AND 15000' IN definition) = 0
    OR position('BETWEEN 5 AND 120' IN definition) = 0
    OR position('job."provider" = execution."provider"' IN definition) = 0
    OR position('credential."provider" = candidate."provider"' IN definition) = 0
    OR position('control."provider" = current_execution."provider"' IN definition) = 0
  THEN
    RAISE EXCEPTION 'XMLStock rank pre-authorization was not generalized safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

COMMIT;
