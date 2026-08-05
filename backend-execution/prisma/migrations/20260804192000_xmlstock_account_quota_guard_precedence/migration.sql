BEGIN;

-- Parenthesize the nested JSONB object before applying the key-removal
-- allowlist. Without the parentheses PostgreSQL can resolve the expression as
-- an ambiguous `unknown - unknown` operator only when the function executes.
DO $migration$
DECLARE
  definition TEXT;
  ambiguous_guard CONSTANT TEXT :=
    'p_provider_meta -> ''account'' - ''requestLimit'' - ''frozenRequestLimit'' - ''usedMonth'' - ''usedToday'' - ''balance'' - ''frozenBalance'' - ''tariffDaysRemaining''';
  explicit_guard CONSTANT TEXT :=
    '(p_provider_meta -> ''account'') - ''requestLimit'' - ''frozenRequestLimit'' - ''usedMonth'' - ''usedToday'' - ''balance'' - ''frozenBalance'' - ''tariffDaysRemaining''';
BEGIN
  SELECT pg_get_functiondef(
    'public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)'::regprocedure
  ) INTO definition;

  IF definition IS NULL OR position(ambiguous_guard IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected XMLStock account quota guard before precedence fix'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(definition, ambiguous_guard, explicit_guard);

  IF position(ambiguous_guard IN definition) > 0
    OR position(explicit_guard IN definition) = 0
  THEN
    RAISE EXCEPTION 'XMLStock account quota guard precedence was not fixed safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

COMMIT;
