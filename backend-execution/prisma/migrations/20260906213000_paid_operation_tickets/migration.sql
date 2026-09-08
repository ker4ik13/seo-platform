ALTER TABLE jobs ADD COLUMN billing_quote_id UUID,
  ADD COLUMN billing_command_hash BYTEA,
  ADD COLUMN billing_maximum_units_milli BIGINT;
CREATE UNIQUE INDEX jobs_billing_quote_key ON jobs(billing_quote_id) WHERE billing_quote_id IS NOT NULL;
ALTER TABLE jobs ADD CONSTRAINT jobs_billing_scope_check CHECK (
  billing_quote_id IS NULL AND billing_command_hash IS NULL AND billing_maximum_units_milli IS NULL
  OR billing_quote_id IS NOT NULL AND billing_command_hash IS NOT NULL AND billing_maximum_units_milli IS NOT NULL AND octet_length(billing_command_hash) = 32 AND billing_maximum_units_milli > 0
    AND credential_mode = 'PLATFORM_PAID' AND type IN ('FREQUENCY_COLLECTION', 'AI_ANSWER_COLLECTION', 'CLUSTERING_RUN', 'KEYWORD_RESEARCH')
);
ALTER TABLE jobs ADD CONSTRAINT jobs_paid_operation_admission_check CHECK (
  credential_mode <> 'PLATFORM_PAID' OR type NOT IN ('FREQUENCY_COLLECTION', 'AI_ANSWER_COLLECTION', 'CLUSTERING_RUN', 'KEYWORD_RESEARCH') OR billing_quote_id IS NOT NULL
) NOT VALID;

CREATE TABLE provider_usage_tickets (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  unit_key VARCHAR(100) NOT NULL,
  part VARCHAR(32) NOT NULL,
  item_ids UUID[] NOT NULL,
  units_milli BIGINT NOT NULL CHECK (units_milli > 0),
  state VARCHAR(16) NOT NULL DEFAULT 'PREPARED' CHECK (state IN ('PREPARED', 'STARTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN')),
  ticket_token UUID NOT NULL DEFAULT uuidv7(),
  lease_owner VARCHAR(100) NOT NULL,
  job_version INTEGER NOT NULL CHECK (job_version > 0),
  lease_expires_at TIMESTAMPTZ(6) NOT NULL,
  authorized_at TIMESTAMPTZ(6),
  result JSONB,
  started_at TIMESTAMPTZ(6),
  finished_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT provider_usage_tickets_unit_key UNIQUE(job_id, unit_key),
  CONSTRAINT provider_usage_tickets_outcome_check CHECK (
    (state IN ('PREPARED', 'REJECTED') OR started_at IS NOT NULL)
    AND (state <> 'ACCEPTED' OR result IS NOT NULL AND finished_at IS NOT NULL)
    AND (result IS NULL OR jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 2097152)
  )
);
CREATE INDEX provider_usage_tickets_job_state_idx ON provider_usage_tickets(job_id, state);

CREATE FUNCTION guard_provider_usage_ticket() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Provider usage evidence cannot be deleted'; END IF;
  IF (NEW.job_id, NEW.unit_key, NEW.part, NEW.item_ids, NEW.units_milli, NEW.created_at)
    IS DISTINCT FROM (OLD.job_id, OLD.unit_key, OLD.part, OLD.item_ids, OLD.units_milli, OLD.created_at)
    OR OLD.state = 'ACCEPTED' AND NEW IS DISTINCT FROM OLD
    OR OLD.state IN ('STARTED', 'UNKNOWN') AND (NEW.ticket_token <> OLD.ticket_token OR NEW.state NOT IN ('ACCEPTED', 'REJECTED', 'UNKNOWN'))
  THEN RAISE EXCEPTION 'Provider usage scope and accepted evidence are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_usage_tickets_immutable BEFORE UPDATE OR DELETE ON provider_usage_tickets
  FOR EACH ROW EXECUTE FUNCTION guard_provider_usage_ticket();
REVOKE ALL ON FUNCTION guard_provider_usage_ticket() FROM PUBLIC;

CREATE FUNCTION guard_job_billing_scope() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (NEW.billing_quote_id, NEW.billing_command_hash, NEW.billing_maximum_units_milli)
    IS DISTINCT FROM (OLD.billing_quote_id, OLD.billing_command_hash, OLD.billing_maximum_units_milli)
  THEN RAISE EXCEPTION 'Job billing admission is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_billing_scope_immutable BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION guard_job_billing_scope();
REVOKE ALL ON FUNCTION guard_job_billing_scope() FROM PUBLIC;

CREATE FUNCTION prepare_provider_usage_ticket(p_job UUID, p_workspace UUID, p_project UUID, p_owner TEXT, p_version INTEGER, p_part TEXT, p_items UUID[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  j public.jobs%ROWTYPE;
  t public.provider_usage_tickets%ROWTYPE;
  r public.keyword_research_runs%ROWTYPE;
  normalized_items UUID[];
  unit_key_value TEXT;
  units BIGINT;
  total_units BIGINT;
  matching_items INTEGER;
BEGIN
  IF p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9._:-]{8,100}$' OR p_version IS NULL OR p_version < 1 OR p_part IS NULL OR length(p_part) > 32 OR p_items IS NULL OR cardinality(p_items) > 300000
  THEN RAISE EXCEPTION 'Invalid provider usage scope'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job AND workspace_id = p_workspace AND project_id = p_project FOR UPDATE;
  IF NOT FOUND OR j.version <> p_version OR j.lease_owner IS DISTINCT FROM p_owner OR j.lease_expires_at IS NULL OR j.lease_expires_at <= clock_timestamp()
    OR j.status <> 'RUNNING' OR j.cancel_requested_at IS NOT NULL OR j.actor_id IS NULL
  THEN RAISE EXCEPTION 'Provider usage lease is not current'; END IF;
  IF j.credential_mode = 'BYOK_API_KEY' THEN RETURN jsonb_build_object('mode', 'BYOK_API_KEY'); END IF;
  IF j.credential_mode <> 'PLATFORM_PAID' OR j.billing_quote_id IS NULL OR j.billing_command_hash IS NULL
  THEN RAISE EXCEPTION 'Provider usage requires a funded admission'; END IF;
  SELECT COALESCE(array_agg(DISTINCT item ORDER BY item), '{}'::UUID[]) INTO normalized_items FROM unnest(p_items) item;
  IF cardinality(normalized_items) <> cardinality(p_items) THEN RAISE EXCEPTION 'Duplicate provider usage items'; END IF;
  IF j.type = 'KEYWORD_RESEARCH' THEN
    IF cardinality(p_items) <> 0 THEN RAISE EXCEPTION 'Unexpected research usage items'; END IF;
    SELECT * INTO r FROM public.keyword_research_runs WHERE job_id = j.id AND status = 'RUNNING';
    IF NOT FOUND THEN RAISE EXCEPTION 'Research scope is unavailable'; END IF;
    IF j.provider = 'XMLSTOCK' AND r.next_page BETWEEN 1 AND jsonb_array_length(j.input_snapshot->'queries') AND p_part = 'SEED:' || r.next_page::text THEN units := 1000;
    ELSIF j.provider = 'ARSENKIN' AND p_part = 'TASK' THEN units := 2000::bigint * jsonb_array_length(j.input_snapshot->'queries');
    ELSE RAISE EXCEPTION 'Unsupported research billing unit'; END IF;
  ELSE
    SELECT count(*) INTO matching_items FROM public.job_items WHERE job_id = j.id AND workspace_id = j.workspace_id AND id = ANY(normalized_items) AND status = 'RUNNING';
    IF matching_items < 1 OR matching_items <> cardinality(normalized_items) THEN RAISE EXCEPTION 'Provider usage item lease is not current'; END IF;
    IF j.type = 'FREQUENCY_COLLECTION' AND j.provider = 'XMLSTOCK' AND matching_items = 1 AND j.input_snapshot->'types' ? p_part THEN units := 1000;
    ELSIF j.type = 'FREQUENCY_COLLECTION' AND j.provider = 'ARSENKIN' AND p_part = 'TASK' THEN units := matching_items::bigint * jsonb_array_length(j.input_snapshot->'types') * 1000;
    ELSIF j.type = 'AI_ANSWER_COLLECTION' AND j.provider = 'ARSENKIN' AND p_part = 'TASK' THEN units := matching_items::bigint * 2000;
    ELSIF j.type = 'CLUSTERING_RUN' AND j.provider = 'ARSENKIN' AND p_part = 'TASK' AND matching_items = j.progress_total THEN units := matching_items::bigint * (1500 + jsonb_array_length(j.input_snapshot->'frequencyTypes') * 1000);
    ELSE RAISE EXCEPTION 'Unsupported provider billing unit'; END IF;
  END IF;
  unit_key_value := p_part || ':' || encode(sha256(convert_to(normalized_items::text, 'UTF8')), 'hex');
  SELECT * INTO t FROM public.provider_usage_tickets WHERE job_id = j.id AND unit_key = unit_key_value FOR UPDATE;
  IF FOUND THEN
    IF t.units_milli <> units OR t.item_ids <> normalized_items THEN RAISE EXCEPTION 'Provider usage unit changed'; END IF;
    IF t.state IN ('PREPARED', 'REJECTED') THEN
      IF t.state = 'PREPARED' AND t.job_version = p_version AND t.lease_owner = p_owner THEN
        -- Concurrent callers may receive the same token; only one can START it.
        NULL;
      ELSE
        UPDATE public.provider_usage_tickets SET state = 'PREPARED', ticket_token = uuidv7(), lease_owner = p_owner,
          job_version = p_version, lease_expires_at = j.lease_expires_at, authorized_at = NULL, started_at = NULL, finished_at = NULL, result = NULL, updated_at = clock_timestamp()
        WHERE id = t.id RETURNING * INTO t;
      END IF;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.provider_usage_tickets WHERE job_id = j.id AND part = p_part AND item_ids && normalized_items)
    THEN RAISE EXCEPTION 'Provider billing batch overlaps an existing unit'; END IF;
    SELECT COALESCE(sum(units_milli), 0) INTO total_units FROM public.provider_usage_tickets WHERE job_id = j.id AND state <> 'REJECTED';
    IF units < 1 OR total_units + units > j.billing_maximum_units_milli THEN RAISE EXCEPTION 'Provider usage exceeds its funded workload'; END IF;
    INSERT INTO public.provider_usage_tickets(job_id, unit_key, part, item_ids, units_milli, lease_owner, job_version, lease_expires_at)
      VALUES (j.id, unit_key_value, p_part, normalized_items, units, p_owner, p_version, j.lease_expires_at) RETURNING * INTO t;
  END IF;
  RETURN jsonb_build_object('mode', 'PLATFORM_PAID', 'id', t.id, 'token', t.ticket_token, 'state', t.state,
    'quoteId', j.billing_quote_id, 'jobId', j.id, 'workspaceId', j.workspace_id, 'projectId', j.project_id, 'actorId', j.actor_id,
    'commandHash', encode(j.billing_command_hash, 'hex'), 'unitsMilli', t.units_milli::text, 'result', t.result);
END $$;

CREATE FUNCTION start_provider_usage_ticket(p_id UUID, p_token UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE changed INTEGER;
BEGIN
  -- Serialize with cancellation and ticket allocation before marking money
  -- exposed. A terminal usage projection can never miss a later STARTED unit.
  PERFORM j.id FROM public.jobs j JOIN public.provider_usage_tickets t ON t.job_id = j.id
    WHERE t.id = p_id AND t.ticket_token = p_token FOR UPDATE OF j;
  UPDATE public.provider_usage_tickets t SET state = 'STARTED', started_at = clock_timestamp(), updated_at = clock_timestamp()
  FROM public.jobs j
  WHERE t.id = p_id AND t.ticket_token = p_token AND t.state = 'PREPARED' AND j.id = t.job_id
    AND t.authorized_at > clock_timestamp() - interval '10 seconds'
    AND j.status = 'RUNNING' AND j.cancel_requested_at IS NULL AND j.version = t.job_version
    AND j.lease_owner = t.lease_owner AND j.lease_expires_at > clock_timestamp() + interval '1 second';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

CREATE FUNCTION finish_provider_usage_ticket(p_id UUID, p_token UUID, p_state TEXT, p_result JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.provider_usage_tickets%ROWTYPE;
BEGIN
  IF p_state NOT IN ('ACCEPTED', 'REJECTED', 'UNKNOWN') OR (p_state = 'ACCEPTED' AND p_result IS NULL)
    OR p_result IS NOT NULL AND (jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text) > 2097152)
  THEN RAISE EXCEPTION 'Invalid provider usage outcome'; END IF;
  SELECT * INTO t FROM public.provider_usage_tickets WHERE id = p_id AND ticket_token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF t.state = p_state AND t.result IS NOT DISTINCT FROM p_result THEN RETURN true; END IF;
  IF t.state NOT IN ('STARTED', 'UNKNOWN') THEN RETURN false; END IF;
  -- An accepted outcome remains chargeable even when cancellation, role
  -- revocation or lease expiry happened during the external request.
  UPDATE public.provider_usage_tickets SET state = p_state, result = p_result, finished_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = t.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION prepare_provider_usage_ticket(UUID, UUID, UUID, TEXT, INTEGER, TEXT, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION start_provider_usage_ticket(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION finish_provider_usage_ticket(UUID, UUID, TEXT, JSONB) FROM PUBLIC;

CREATE FUNCTION read_provider_operation_mode(p_job UUID, p_workspace UUID, p_project UUID, p_owner TEXT, p_version INTEGER)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE mode_value TEXT;
BEGIN
  SELECT credential_mode::text INTO mode_value FROM public.jobs
    WHERE id = p_job AND workspace_id = p_workspace AND project_id = p_project AND version = p_version
      AND lease_owner = p_owner AND lease_expires_at > clock_timestamp() AND status = 'RUNNING';
  IF mode_value IS NULL OR mode_value NOT IN ('BYOK_API_KEY', 'PLATFORM_PAID') THEN RAISE EXCEPTION 'Provider operation lease is not current'; END IF;
  RETURN mode_value;
END $$;
REVOKE ALL ON FUNCTION read_provider_operation_mode(UUID, UUID, UUID, TEXT, INTEGER) FROM PUBLIC;
