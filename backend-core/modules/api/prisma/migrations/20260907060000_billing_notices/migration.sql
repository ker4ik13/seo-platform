CREATE TABLE billing_notices (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind VARCHAR(40) NOT NULL,
  reference_id UUID NOT NULL,
  reference_state VARCHAR(24),
  period_end TIMESTAMPTZ(6),
  business_key VARCHAR(180) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT billing_notices_kind_check CHECK (kind IN ('PAYMENT_SUCCEEDED', 'REFUND_REQUESTED', 'REFUND_APPROVED', 'REFUND_REJECTED', 'REFUND_SUCCEEDED', 'REFUND_FAILED', 'SUBSCRIPTION_ENDING_3D', 'SUBSCRIPTION_ENDING_1D', 'SUBSCRIPTION_EXPIRED'))
);
CREATE INDEX billing_notices_workspace_idx ON billing_notices(workspace_id, created_at);
CREATE INDEX billing_payments_notice_scan_idx ON billing_payments(succeeded_at, id) WHERE is_test = false AND succeeded_at IS NOT NULL;
CREATE FUNCTION billing_guard_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'billing notice intent is immutable' USING ERRCODE = 'check_violation'; END $$;
CREATE TRIGGER billing_notices_immutable BEFORE UPDATE OR DELETE ON billing_notices
  FOR EACH ROW EXECUTE FUNCTION billing_guard_notice();
CREATE TRIGGER billing_notices_no_truncate BEFORE TRUNCATE ON billing_notices
  FOR EACH STATEMENT EXECUTE FUNCTION billing_guard_notice();
