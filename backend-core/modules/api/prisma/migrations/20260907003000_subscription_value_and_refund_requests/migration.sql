-- New valuation is populated only by a subsequent paid action. Existing
-- subscriptions retain their exact plans, periods, payment references and data.
ALTER TABLE billing_subscriptions ADD COLUMN service_value_minor BIGINT,
  ADD COLUMN service_value_at TIMESTAMPTZ(6), ADD COLUMN refundable_from TIMESTAMPTZ(6),
  ADD CONSTRAINT billing_subscription_value_check CHECK (service_value_minor IS NULL OR service_value_minor >= 0 AND service_value_at IS NOT NULL);

CREATE TABLE billing_refund_requests (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES billing_payments(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_amount_minor BIGINT NOT NULL CHECK (requested_amount_minor > 0),
  approved_amount_minor BIGINT CHECK (approved_amount_minor > 0 AND approved_amount_minor <= requested_amount_minor),
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'MANUAL_REQUIRED', 'SUCCEEDED', 'REJECTED', 'FAILED')),
  decision_reason VARCHAR(500),
  decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ(6),
  held_prepaid_minor BIGINT NOT NULL DEFAULT 0 CHECK (held_prepaid_minor >= 0),
  hold_released_at TIMESTAMPTZ(6),
  subscription_adjustment JSONB,
  manual_reference VARCHAR(180),
  request_idempotency_key VARCHAR(180) NOT NULL,
  request_hash BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT billing_refund_requests_idempotency_key UNIQUE(workspace_id, request_idempotency_key),
  CONSTRAINT billing_refund_requests_decision_check CHECK (
    status = 'REQUESTED' AND approved_amount_minor IS NULL AND decided_at IS NULL AND decided_by IS NULL
    OR status = 'REJECTED' AND approved_amount_minor IS NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL
    OR status NOT IN ('REQUESTED', 'REJECTED') AND approved_amount_minor IS NOT NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL
  ),
  CONSTRAINT billing_refund_requests_hold_check CHECK (held_prepaid_minor = 0 OR approved_amount_minor IS NOT NULL AND held_prepaid_minor = approved_amount_minor)
);
CREATE UNIQUE INDEX billing_refund_requests_open_payment_key ON billing_refund_requests(payment_id)
  WHERE status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'MANUAL_REQUIRED');
CREATE INDEX billing_refund_requests_queue_idx ON billing_refund_requests(status, created_at, id);
CREATE INDEX billing_refund_requests_workspace_idx ON billing_refund_requests(workspace_id, created_at DESC);
ALTER TABLE billing_refunds ADD COLUMN refund_request_id UUID UNIQUE REFERENCES billing_refund_requests(id) ON DELETE RESTRICT;

CREATE FUNCTION guard_billing_refund_request() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Refund requests are retained financial history'; END IF;
  IF (NEW.workspace_id, NEW.payment_id, NEW.requested_by, NEW.requested_amount_minor, NEW.reason, NEW.request_idempotency_key, NEW.request_hash, NEW.created_at)
    IS DISTINCT FROM (OLD.workspace_id, OLD.payment_id, OLD.requested_by, OLD.requested_amount_minor, OLD.reason, OLD.request_idempotency_key, OLD.request_hash, OLD.created_at)
    OR OLD.status <> 'REQUESTED' AND
      (NEW.approved_amount_minor, NEW.decided_by, NEW.decided_at, NEW.decision_reason, NEW.held_prepaid_minor, NEW.subscription_adjustment)
      IS DISTINCT FROM (OLD.approved_amount_minor, OLD.decided_by, OLD.decided_at, OLD.decision_reason, OLD.held_prepaid_minor, OLD.subscription_adjustment)
    OR OLD.status IN ('SUCCEEDED', 'REJECTED', 'FAILED') AND NEW IS DISTINCT FROM OLD
    OR NEW.version < OLD.version
  THEN RAISE EXCEPTION 'Refund request scope and decision are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_refund_requests_immutable BEFORE UPDATE OR DELETE ON billing_refund_requests
  FOR EACH ROW EXECUTE FUNCTION guard_billing_refund_request();
REVOKE ALL ON FUNCTION guard_billing_refund_request() FROM PUBLIC;
