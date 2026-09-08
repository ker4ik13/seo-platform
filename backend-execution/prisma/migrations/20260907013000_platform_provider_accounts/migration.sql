CREATE TABLE platform_provider_accounts (
  id UUID PRIMARY KEY,
  provider VARCHAR(16) NOT NULL CHECK (provider IN ('XMLSTOCK', 'ARSENKIN')),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 64),
  credential_id UUID REFERENCES integration_credentials(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  remaining NUMERIC(24,6) CHECK (remaining >= 0),
  checked_at TIMESTAMPTZ(6),
  error_code VARCHAR(64),
  next_probe_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  lease_owner VARCHAR(100),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CHECK ((lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX platform_provider_accounts_due_idx ON platform_provider_accounts(enabled, next_probe_at, id);

CREATE FUNCTION claim_platform_provider_account_probe(p_owner TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a public.platform_provider_accounts%ROWTYPE; c public.integration_credentials%ROWTYPE;
BEGIN
  IF p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9._:-]{8,100}$' THEN RAISE EXCEPTION 'Invalid provider probe owner'; END IF;
  SELECT * INTO a FROM public.platform_provider_accounts WHERE enabled AND next_probe_at <= clock_timestamp()
    AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
    ORDER BY next_probe_at, id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.integration_credentials credential
    WHERE credential.provider = a.provider AND credential.mode = 'PLATFORM_PAID' AND credential.deleted_at IS NULL
      AND (credential.id = a.credential_id OR credential.provider_meta->'platformAccountIds' ? a.id::text OR NOT COALESCE(credential.provider_meta ? 'platformAccountIds', false))
    ORDER BY (credential.id = a.credential_id) DESC NULLS LAST, credential.created_at DESC, credential.id LIMIT 1;
  IF NOT FOUND THEN
    UPDATE public.platform_provider_accounts SET error_code = 'CREDENTIAL_UNAVAILABLE', next_probe_at = clock_timestamp() + interval '5 minutes', updated_at = clock_timestamp() WHERE id = a.id;
    RETURN NULL;
  END IF;
  UPDATE public.platform_provider_accounts SET lease_owner = p_owner, lease_token = uuidv7(), lease_expires_at = clock_timestamp() + interval '90 seconds', updated_at = clock_timestamp()
    WHERE id = a.id RETURNING * INTO a;
  RETURN jsonb_build_object('id', a.id, 'provider', a.provider, 'token', a.lease_token, 'workspaceId', c.workspace_id, 'credentialId', c.id,
    'ciphertext', encode(c.ciphertext, 'base64'), 'nonce', encode(c.nonce, 'base64'), 'authTag', encode(c.auth_tag, 'base64'),
    'encryptedDataKey', encode(c.encrypted_data_key, 'base64'), 'dataKeyNonce', encode(c.data_key_nonce, 'base64'), 'dataKeyAuthTag', encode(c.data_key_auth_tag, 'base64'), 'keyVersion', c.key_version);
END $$;
CREATE FUNCTION finish_platform_provider_account_probe(p_id UUID, p_owner TEXT, p_token UUID, p_remaining TEXT, p_error TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE changed INTEGER;
BEGIN
  IF (p_remaining IS NULL) = (p_error IS NULL)
    OR p_remaining IS NOT NULL AND p_remaining !~ '^(0|[1-9][0-9]{0,15})(\.[0-9]{1,6})?$'
    OR p_error IS NOT NULL AND p_error !~ '^[A-Z][A-Z0-9_]{0,63}$'
  THEN RAISE EXCEPTION 'Invalid provider account observation'; END IF;
  UPDATE public.platform_provider_accounts SET remaining = CASE WHEN p_remaining IS NULL THEN remaining ELSE p_remaining::numeric END,
    checked_at = CASE WHEN p_remaining IS NULL THEN checked_at ELSE clock_timestamp() END,
    error_code = p_error, next_probe_at = clock_timestamp() + CASE WHEN p_error = 'PROVIDER_RATE_LIMITED' THEN interval '30 seconds' ELSE interval '5 minutes' END,
    lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
    WHERE id = p_id AND lease_owner = p_owner AND lease_token = p_token AND lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed = ROW_COUNT; RETURN changed = 1;
END $$;
REVOKE ALL ON FUNCTION claim_platform_provider_account_probe(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION finish_platform_provider_account_probe(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
