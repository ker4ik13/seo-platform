CREATE FUNCTION public.list_enabled_platform_provider_account_ids(
  p_provider TEXT,
  p_account_ids UUID[]
)
RETURNS TABLE (id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_provider IS NULL OR
     p_provider NOT IN ('XMLSTOCK', 'ARSENKIN') OR
     p_account_ids IS NULL OR
     cardinality(p_account_ids) NOT BETWEEN 1 AND 64 OR
     array_position(p_account_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid platform provider account scope'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT account.id
  FROM public.platform_provider_accounts account
  WHERE account.provider = p_provider
    AND account.enabled
    AND account.id = ANY(p_account_ids)
  ORDER BY account.id;
END
$$;

REVOKE ALL ON FUNCTION
  public.list_enabled_platform_provider_account_ids(TEXT, UUID[])
  FROM PUBLIC;

DROP FUNCTION public.claim_platform_provider_account_probe(TEXT);
DROP FUNCTION public.finish_platform_provider_account_probe(UUID, TEXT, UUID, TEXT, TEXT);
