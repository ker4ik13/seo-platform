-- Additive Core-owned estimates and escrow. No existing ledger/subscription is rewritten.
CREATE TABLE billing_operation_quotes (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind VARCHAR(32) NOT NULL CHECK (kind IN ('FREQUENCY_COLLECTION', 'AI_ANSWER_COLLECTION', 'CLUSTERING_RUN', 'KEYWORD_RESEARCH')),
  provider VARCHAR(16) NOT NULL CHECK (provider IN ('ARSENKIN', 'XMLSTOCK')),
  route_snapshot JSONB NOT NULL CHECK (jsonb_typeof(route_snapshot) = 'object'),
  command_hash BYTEA NOT NULL CHECK (octet_length(command_hash) = 32),
  command_key VARCHAR(180),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 300000),
  price_book_version VARCHAR(64) NOT NULL,
  unit_cost_micro BIGINT NOT NULL CHECK (unit_cost_micro > 0),
  price_denominator_bps INTEGER NOT NULL CHECK (price_denominator_bps BETWEEN 1 AND 10000),
  maximum_provider_units_milli BIGINT NOT NULL CHECK (maximum_provider_units_milli > 0),
  maximum_charge_minor BIGINT NOT NULL CHECK (maximum_charge_minor BETWEEN 1 AND 100000000),
  status VARCHAR(16) NOT NULL DEFAULT 'QUOTED' CHECK (status IN ('QUOTED', 'RESERVED', 'SETTLED', 'REVIEW')),
  job_id UUID UNIQUE,
  included_minor BIGINT NOT NULL DEFAULT 0 CHECK (included_minor >= 0),
  prepaid_minor BIGINT NOT NULL DEFAULT 0 CHECK (prepaid_minor >= 0),
  included_period_end TIMESTAMPTZ(6),
  captured_minor BIGINT NOT NULL DEFAULT 0 CHECK (captured_minor >= 0),
  released_minor BIGINT NOT NULL DEFAULT 0 CHECK (released_minor >= 0),
  accepted_provider_units_milli BIGINT NOT NULL DEFAULT 0 CHECK (accepted_provider_units_milli >= 0),
  expires_at TIMESTAMPTZ(6) NOT NULL,
  create_before TIMESTAMPTZ(6),
  reserved_at TIMESTAMPTZ(6),
  settled_at TIMESTAMPTZ(6),
  next_check_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT billing_operation_quotes_command_key UNIQUE(workspace_id, kind, command_key),
  CONSTRAINT billing_operation_quotes_amount_check CHECK (
    captured_minor + released_minor <= maximum_charge_minor
    AND accepted_provider_units_milli <= maximum_provider_units_milli
    AND (status = 'QUOTED' AND included_minor = 0 AND prepaid_minor = 0 AND job_id IS NULL AND command_key IS NULL
      OR status <> 'QUOTED' AND included_minor + prepaid_minor = maximum_charge_minor AND job_id IS NOT NULL AND command_key IS NOT NULL AND reserved_at IS NOT NULL AND create_before IS NOT NULL)
    AND (status <> 'SETTLED' OR captured_minor + released_minor = maximum_charge_minor AND settled_at IS NOT NULL)
  )
);
CREATE INDEX billing_operation_quotes_reconcile_idx ON billing_operation_quotes(status, next_check_at, id);
CREATE INDEX billing_operation_quotes_tenant_idx ON billing_operation_quotes(workspace_id, created_at DESC);

CREATE FUNCTION guard_billing_operation_quote() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'QUOTED' THEN RAISE EXCEPTION 'Funded operation quotes are immutable financial history'; END IF;
    RETURN OLD;
  END IF;
  IF (NEW.workspace_id, NEW.project_id, NEW.actor_id, NEW.kind, NEW.provider, NEW.route_snapshot, NEW.command_hash,
      NEW.quantity, NEW.price_book_version, NEW.unit_cost_micro, NEW.price_denominator_bps, NEW.maximum_provider_units_milli,
      NEW.maximum_charge_minor, NEW.expires_at, NEW.created_at)
    IS DISTINCT FROM
     (OLD.workspace_id, OLD.project_id, OLD.actor_id, OLD.kind, OLD.provider, OLD.route_snapshot, OLD.command_hash,
      OLD.quantity, OLD.price_book_version, OLD.unit_cost_micro, OLD.price_denominator_bps, OLD.maximum_provider_units_milli,
      OLD.maximum_charge_minor, OLD.expires_at, OLD.created_at)
    OR OLD.status <> 'QUOTED' AND
      (NEW.command_key, NEW.job_id, NEW.included_minor, NEW.prepaid_minor, NEW.included_period_end, NEW.create_before, NEW.reserved_at)
      IS DISTINCT FROM
      (OLD.command_key, OLD.job_id, OLD.included_minor, OLD.prepaid_minor, OLD.included_period_end, OLD.create_before, OLD.reserved_at)
    OR NEW.captured_minor < OLD.captured_minor OR NEW.released_minor < OLD.released_minor
    OR NEW.accepted_provider_units_milli < OLD.accepted_provider_units_milli
    OR OLD.status = 'SETTLED' AND NEW IS DISTINCT FROM OLD
    OR OLD.status <> 'QUOTED' AND NEW.status = 'QUOTED'
  THEN RAISE EXCEPTION 'Operation quote financial scope is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_operation_quotes_immutable BEFORE UPDATE OR DELETE ON billing_operation_quotes
  FOR EACH ROW EXECUTE FUNCTION guard_billing_operation_quote();
REVOKE ALL ON FUNCTION guard_billing_operation_quote() FROM PUBLIC;
