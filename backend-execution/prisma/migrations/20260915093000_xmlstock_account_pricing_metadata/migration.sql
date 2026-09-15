BEGIN;

-- XMLStock `info=user` and `info=status` expose account-specific rates and
-- safe product capacity. Extend only the existing fenced validation finish
-- boundary; provider URLs (which contain credential material) are never
-- accepted into provider_meta.
DO $migration$
DECLARE
  definition TEXT;
  old_allowlist CONSTANT TEXT :=
    'p_provider_meta - ''account'' - ''wordstat'' - ''regionCatalogAvailable''';
  new_allowlist CONSTANT TEXT :=
    'p_provider_meta - ''account'' - ''xmlStockPricing'' - ''xmlStockStatus'' - ''wordstat'' - ''regionCatalogAvailable''';
  insertion_point CONSTANT TEXT :=
    E'      OR ((p_provider_meta ? ''wordstat'') <> (p_provider_meta ? ''regionCatalogAvailable''))\n';
  pricing_guard CONSTANT TEXT :=
    E'      OR (p_provider_meta ? ''xmlStockPricing'' AND (\n'
    || E'        jsonb_typeof(p_provider_meta -> ''xmlStockPricing'') IS DISTINCT FROM ''object''\n'
    || E'        OR (p_provider_meta -> ''xmlStockPricing'') - ''tariffCode'' - ''currency'' - ''priceUnit'' - ''pricesPerThousand'' <> ''{}''::JSONB\n'
    || E'        OR p_provider_meta -> ''xmlStockPricing'' ->> ''tariffCode'' NOT IN (''BASIC'', ''OPTIMAL'', ''MAXIMUM'', ''PREMIUM'', ''CUSTOM'')\n'
    || E'        OR p_provider_meta -> ''xmlStockPricing'' ->> ''currency'' IS DISTINCT FROM ''RUB''\n'
    || E'        OR p_provider_meta -> ''xmlStockPricing'' ->> ''priceUnit'' IS DISTINCT FROM ''PER_1000_REQUESTS''\n'
    || E'        OR jsonb_typeof(p_provider_meta -> ''xmlStockPricing'' -> ''pricesPerThousand'') IS DISTINCT FROM ''object''\n'
    || E'        OR jsonb_object_length(p_provider_meta -> ''xmlStockPricing'' -> ''pricesPerThousand'') IS DISTINCT FROM 5\n'
    || E'        OR (p_provider_meta -> ''xmlStockPricing'' -> ''pricesPerThousand'') - ''YANDEX_SEARCH_API'' - ''YANDEX_LIVE'' - ''YANDEX_TURBO'' - ''GOOGLE_LIVE'' - ''WORDSTAT'' <> ''{}''::JSONB\n'
    || E'        OR EXISTS (SELECT 1 FROM jsonb_each(p_provider_meta -> ''xmlStockPricing'' -> ''pricesPerThousand'') price WHERE jsonb_typeof(price.value) IS DISTINCT FROM ''string'' OR price.value #>> ''{}'' !~ ''^(0|[1-9][0-9]*)([.][0-9]{1,6})?$'')\n'
    || E'      ))\n'
    || E'      OR (p_provider_meta ? ''xmlStockStatus'' AND (\n'
    || E'        jsonb_typeof(p_provider_meta -> ''xmlStockStatus'') IS DISTINCT FROM ''object''\n'
    || E'        OR (p_provider_meta -> ''xmlStockStatus'') - ''availableRequests'' - ''loadPercent'' <> ''{}''::JSONB\n'
    || E'        OR jsonb_typeof(p_provider_meta -> ''xmlStockStatus'' -> ''availableRequests'') IS DISTINCT FROM ''object''\n'
    || E'        OR jsonb_object_length(p_provider_meta -> ''xmlStockStatus'' -> ''availableRequests'') IS DISTINCT FROM 4\n'
    || E'        OR (p_provider_meta -> ''xmlStockStatus'' -> ''availableRequests'') - ''GOOGLE_LIVE'' - ''YANDEX_LIVE'' - ''YANDEX_TURBO'' - ''YANDEX_SEARCH_API'' <> ''{}''::JSONB\n'
    || E'        OR EXISTS (SELECT 1 FROM jsonb_each(p_provider_meta -> ''xmlStockStatus'' -> ''availableRequests'') available WHERE jsonb_typeof(available.value) IS DISTINCT FROM ''number'' OR available.value #>> ''{}'' !~ ''^(0|[1-9][0-9]{0,15})$'' OR (available.value #>> ''{}'')::NUMERIC > 9007199254740991)\n'
    || E'        OR jsonb_typeof(p_provider_meta -> ''xmlStockStatus'' -> ''loadPercent'') IS DISTINCT FROM ''object''\n'
    || E'        OR jsonb_object_length(p_provider_meta -> ''xmlStockStatus'' -> ''loadPercent'') IS DISTINCT FROM 2\n'
    || E'        OR (p_provider_meta -> ''xmlStockStatus'' -> ''loadPercent'') - ''GOOGLE_LIVE'' - ''YANDEX_LIVE'' <> ''{}''::JSONB\n'
    || E'        OR EXISTS (SELECT 1 FROM jsonb_each(p_provider_meta -> ''xmlStockStatus'' -> ''loadPercent'') load WHERE jsonb_typeof(load.value) IS DISTINCT FROM ''number'' OR load.value #>> ''{}'' !~ ''^(0|[1-9][0-9]{0,2})$'' OR (load.value #>> ''{}'')::INTEGER > 100)\n'
    || E'      ))\n';
BEGIN
  SELECT pg_get_functiondef(
    'public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR position(old_allowlist IN definition) = 0
    OR position(insertion_point IN definition) = 0
  THEN
    RAISE EXCEPTION 'Unexpected XMLStock validation guard before pricing migration'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(definition, old_allowlist, new_allowlist);
  definition := replace(
    definition,
    insertion_point,
    pricing_guard || insertion_point
  );

  IF position(old_allowlist IN definition) > 0
    OR position(new_allowlist IN definition) = 0
    OR position(pricing_guard IN definition) = 0
  THEN
    RAISE EXCEPTION 'XMLStock validation pricing guard was not extended safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

COMMIT;
