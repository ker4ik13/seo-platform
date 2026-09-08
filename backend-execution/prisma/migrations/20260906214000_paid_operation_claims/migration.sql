-- Preserve all existing item/lease/routing and provider-capacity policies.
-- Permit system credentials only for Jobs carrying immutable Core admission.
DO $$
DECLARE routine RECORD; definition TEXT; updated TEXT; changed INTEGER := 0;
BEGIN
  FOR routine IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('claim_keyword_research_run', 'claim_frequency_collection_item', 'claim_frequency_collection_batch', 'claim_ai_answer_collection_batch', 'claim_clustering_run')
  LOOP
    definition := pg_get_functiondef(routine.oid);
    updated := replace(definition, $old$credential.mode = 'BYOK_API_KEY'$old$,
      $new$credential.mode = job_row.credential_mode
      AND (credential.mode = 'BYOK_API_KEY' OR credential.mode = 'PLATFORM_PAID' AND job_row.billing_quote_id IS NOT NULL)$new$);
    IF updated <> definition THEN EXECUTE updated; changed := changed + 1; END IF;
  END LOOP;
  IF changed < 4 THEN RAISE EXCEPTION 'Expected provider claim boundaries were not found'; END IF;
END $$;
