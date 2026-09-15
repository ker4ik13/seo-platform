BEGIN;

-- PostgreSQL exposes jsonb_object_keys but not jsonb_object_length. The prior
-- guard migration was accepted because the validation function body is
-- dynamic PL/pgSQL; replace all three object-size checks before the next
-- provider validation executes.
DO $migration$
DECLARE
  definition TEXT;
  old_prices CONSTANT TEXT :=
    'jsonb_object_length(p_provider_meta -> ''xmlStockPricing'' -> ''pricesPerThousand'')';
  new_prices CONSTANT TEXT :=
    '(SELECT count(*) FROM jsonb_object_keys(p_provider_meta -> ''xmlStockPricing'' -> ''pricesPerThousand''))';
  old_available CONSTANT TEXT :=
    'jsonb_object_length(p_provider_meta -> ''xmlStockStatus'' -> ''availableRequests'')';
  new_available CONSTANT TEXT :=
    '(SELECT count(*) FROM jsonb_object_keys(p_provider_meta -> ''xmlStockStatus'' -> ''availableRequests''))';
  old_load CONSTANT TEXT :=
    'jsonb_object_length(p_provider_meta -> ''xmlStockStatus'' -> ''loadPercent'')';
  new_load CONSTANT TEXT :=
    '(SELECT count(*) FROM jsonb_object_keys(p_provider_meta -> ''xmlStockStatus'' -> ''loadPercent''))';
BEGIN
  SELECT pg_get_functiondef(
    'public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR position(old_prices IN definition) = 0
    OR position(old_available IN definition) = 0
    OR position(old_load IN definition) = 0
  THEN
    RAISE EXCEPTION 'Unexpected XMLStock pricing guard before object count fix'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(definition, old_prices, new_prices);
  definition := replace(definition, old_available, new_available);
  definition := replace(definition, old_load, new_load);

  IF position(old_prices IN definition) > 0
    OR position(old_available IN definition) > 0
    OR position(old_load IN definition) > 0
    OR position(new_prices IN definition) = 0
    OR position(new_available IN definition) = 0
    OR position(new_load IN definition) = 0
  THEN
    RAISE EXCEPTION 'XMLStock pricing object count fix is incomplete'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

COMMIT;
