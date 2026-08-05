BEGIN;

-- XMLStock's read-only account endpoint returns the current request quota,
-- usage and RUB balance. Keep the existing lease/tenant/version fencing and
-- widen only the provider-specific metadata allowlist at the final DB
-- boundary.
DO $migration$
DECLARE
  definition TEXT;
  old_xmlstock_guard CONSTANT TEXT :=
    E'  ELSIF current_job."provider" = ''XMLSTOCK'' THEN\n'
    || E'    IF p_provider_meta IS NULL\n'
    || E'      OR jsonb_typeof(p_provider_meta) IS DISTINCT FROM ''object''\n'
    || E'      OR p_provider_meta - ''wordstat'' - ''regionCatalogAvailable'' <> ''{}''::JSONB\n'
    || E'      OR p_provider_meta -> ''wordstat'' IS DISTINCT FROM ''true''::JSONB\n'
    || E'      OR p_provider_meta -> ''regionCatalogAvailable'' IS DISTINCT FROM ''true''::JSONB\n'
    || E'    THEN\n'
    || E'      RAISE EXCEPTION ''Invalid XMLStock validation metadata''\n'
    || E'        USING ERRCODE = ''22023'';\n'
    || E'    END IF;';
  new_xmlstock_guard CONSTANT TEXT :=
    E'  ELSIF current_job."provider" = ''XMLSTOCK'' THEN\n'
    || E'    IF p_provider_meta IS NULL\n'
    || E'      OR jsonb_typeof(p_provider_meta) IS DISTINCT FROM ''object''\n'
    || E'      OR p_provider_meta - ''account'' - ''wordstat'' - ''regionCatalogAvailable'' <> ''{}''::JSONB\n'
    || E'      OR jsonb_typeof(p_provider_meta -> ''account'') IS DISTINCT FROM ''object''\n'
    || E'      OR p_provider_meta -> ''account'' - ''requestLimit'' - ''frozenRequestLimit'' - ''usedMonth'' - ''usedToday'' - ''balance'' - ''frozenBalance'' - ''tariffDaysRemaining'' <> ''{}''::JSONB\n'
    || E'      OR jsonb_typeof(p_provider_meta -> ''account'' -> ''requestLimit'') IS DISTINCT FROM ''number''\n'
    || E'      OR jsonb_typeof(p_provider_meta -> ''account'' -> ''frozenRequestLimit'') IS DISTINCT FROM ''number''\n'
    || E'      OR jsonb_typeof(p_provider_meta -> ''account'' -> ''usedMonth'') IS DISTINCT FROM ''number''\n'
    || E'      OR jsonb_typeof(p_provider_meta -> ''account'' -> ''usedToday'') IS DISTINCT FROM ''number''\n'
    || E'      OR jsonb_typeof(p_provider_meta -> ''account'' -> ''tariffDaysRemaining'') IS DISTINCT FROM ''number''\n'
    || E'      OR COALESCE(p_provider_meta -> ''account'' ->> ''requestLimit'' !~ ''^(0|[1-9][0-9]{0,15})$'', TRUE)\n'
    || E'      OR COALESCE(p_provider_meta -> ''account'' ->> ''frozenRequestLimit'' !~ ''^(0|[1-9][0-9]{0,15})$'', TRUE)\n'
    || E'      OR COALESCE(p_provider_meta -> ''account'' ->> ''usedMonth'' !~ ''^(0|[1-9][0-9]{0,15})$'', TRUE)\n'
    || E'      OR COALESCE(p_provider_meta -> ''account'' ->> ''usedToday'' !~ ''^(0|[1-9][0-9]{0,15})$'', TRUE)\n'
    || E'      OR COALESCE(p_provider_meta -> ''account'' ->> ''tariffDaysRemaining'' !~ ''^(0|[1-9][0-9]{0,15})$'', TRUE)\n'
    || E'      OR (p_provider_meta -> ''account'' ->> ''requestLimit'')::NUMERIC > 9007199254740991\n'
    || E'      OR (p_provider_meta -> ''account'' ->> ''frozenRequestLimit'')::NUMERIC > 9007199254740991\n'
    || E'      OR (p_provider_meta -> ''account'' ->> ''usedMonth'')::NUMERIC > 9007199254740991\n'
    || E'      OR (p_provider_meta -> ''account'' ->> ''usedToday'')::NUMERIC > 9007199254740991\n'
    || E'      OR (p_provider_meta -> ''account'' ->> ''tariffDaysRemaining'')::NUMERIC > 9007199254740991\n'
    || E'      OR jsonb_typeof(p_provider_meta -> ''account'' -> ''balance'') IS DISTINCT FROM ''string''\n'
    || E'      OR jsonb_typeof(p_provider_meta -> ''account'' -> ''frozenBalance'') IS DISTINCT FROM ''string''\n'
    || E'      OR COALESCE(p_provider_meta -> ''account'' ->> ''balance'' !~ ''^(0|[1-9][0-9]*)([.][0-9]{1,8})?$'', TRUE)\n'
    || E'      OR COALESCE(p_provider_meta -> ''account'' ->> ''frozenBalance'' !~ ''^(0|[1-9][0-9]*)([.][0-9]{1,8})?$'', TRUE)\n'
    || E'      OR ((p_provider_meta ? ''wordstat'') <> (p_provider_meta ? ''regionCatalogAvailable''))\n'
    || E'      OR (p_provider_meta ? ''wordstat'' AND p_provider_meta -> ''wordstat'' IS DISTINCT FROM ''true''::JSONB)\n'
    || E'      OR (p_provider_meta ? ''regionCatalogAvailable'' AND p_provider_meta -> ''regionCatalogAvailable'' IS DISTINCT FROM ''true''::JSONB)\n'
    || E'    THEN\n'
    || E'      RAISE EXCEPTION ''Invalid XMLStock validation metadata''\n'
    || E'        USING ERRCODE = ''22023'';\n'
    || E'    END IF;';
BEGIN
  SELECT pg_get_functiondef(
    'public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)'::regprocedure
  ) INTO definition;

  IF definition IS NULL OR position(old_xmlstock_guard IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected XMLStock validation guard before account quota migration'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(definition, old_xmlstock_guard, new_xmlstock_guard);

  IF position(old_xmlstock_guard IN definition) > 0
    OR position(new_xmlstock_guard IN definition) = 0
  THEN
    RAISE EXCEPTION 'XMLStock account quota metadata guard was not extended safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

COMMIT;
