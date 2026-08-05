BEGIN;

-- The XMLStock connector has always validated a credential through the
-- read-only Wordstat region catalog, but the broker success boundary still
-- only admitted Arsenkin and Keys.so metadata. Extend the existing hardened
-- function without weakening its lease, version or tenant fencing.
DO $migration$
DECLARE
  definition TEXT;
  unsupported_provider CONSTANT TEXT :=
    E'  ELSE\n    RAISE EXCEPTION ''Provider does not support credential validation success''';
  xmlstock_provider CONSTANT TEXT :=
    E'  ELSIF current_job."provider" = ''XMLSTOCK'' THEN\n'
    || E'    IF p_provider_meta IS NULL\n'
    || E'      OR jsonb_typeof(p_provider_meta) IS DISTINCT FROM ''object''\n'
    || E'      OR p_provider_meta - ''wordstat'' - ''regionCatalogAvailable'' <> ''{}''::JSONB\n'
    || E'      OR p_provider_meta -> ''wordstat'' IS DISTINCT FROM ''true''::JSONB\n'
    || E'      OR p_provider_meta -> ''regionCatalogAvailable'' IS DISTINCT FROM ''true''::JSONB\n'
    || E'    THEN\n'
    || E'      RAISE EXCEPTION ''Invalid XMLStock validation metadata''\n'
    || E'        USING ERRCODE = ''22023'';\n'
    || E'    END IF;\n'
    || unsupported_provider;
  keys_capabilities CONSTANT TEXT :=
    E'        WHEN ''KEYS_SO'' THEN\n'
    || E'          ''["KEYWORD_RESEARCH","COMPETITOR_RESEARCH","SERP_COLLECTION"]''::JSONB\n'
    || E'        ELSE ''[]''::JSONB';
  xmlstock_capabilities CONSTANT TEXT :=
    E'        WHEN ''KEYS_SO'' THEN\n'
    || E'          ''["KEYWORD_RESEARCH","COMPETITOR_RESEARCH","SERP_COLLECTION"]''::JSONB\n'
    || E'        WHEN ''XMLSTOCK'' THEN\n'
    || E'          ''["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT"]''::JSONB\n'
    || E'        ELSE ''[]''::JSONB';
BEGIN
  SELECT pg_get_functiondef(
    'public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR position(unsupported_provider IN definition) = 0
    OR position(keys_capabilities IN definition) = 0
  THEN
    RAISE EXCEPTION 'Unexpected credential validation success function before XMLStock migration'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(definition, unsupported_provider, xmlstock_provider);
  definition := replace(definition, keys_capabilities, xmlstock_capabilities);

  IF position(unsupported_provider IN definition) = 0
    OR position(xmlstock_provider IN definition) = 0
    OR position(xmlstock_capabilities IN definition) = 0
  THEN
    RAISE EXCEPTION 'XMLStock credential validation success was not extended safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

-- The public claim wrapper delegates to this pre-authorization primitive.
-- The earlier XMLStock migration changed the wrapper, where the 25-second
-- check no longer existed, leaving all real submit claims rejected. Extend
-- the actual network lease to the runtime's bounded 120-second maximum.
DO $migration$
DECLARE
  definition TEXT;
  old_bound CONSTANT TEXT := 'BETWEEN 5 AND 25';
  new_bound CONSTANT TEXT := 'BETWEEN 5 AND 120';
  old_error CONSTANT TEXT :=
    'Rank connector lease must be between 5 and 25 seconds';
  new_error CONSTANT TEXT :=
    'Rank connector lease must be between 5 and 120 seconds';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution_pre_authorization(text,integer,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR position(old_bound IN definition) = 0
    OR position(old_error IN definition) = 0
  THEN
    RAISE EXCEPTION 'Unexpected rank pre-authorization lease before XMLStock migration'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(definition, old_bound, new_bound);
  definition := replace(definition, old_error, new_error);

  IF position(old_bound IN definition) > 0
    OR position(old_error IN definition) > 0
    OR position(new_bound IN definition) = 0
    OR position(new_error IN definition) = 0
  THEN
    RAISE EXCEPTION 'Rank pre-authorization lease was not extended safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

COMMIT;
