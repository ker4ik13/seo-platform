-- Nullable additions preserve all historical economics and settlement rows.
ALTER TABLE billing_usage_reservations
  ADD COLUMN provider_started_at TIMESTAMPTZ(6),
  ADD COLUMN review_decision JSONB;

ALTER TABLE billing_usage_reservations DROP CONSTRAINT billing_usage_reservations_state_check;
ALTER TABLE billing_usage_reservations ADD CONSTRAINT billing_usage_reservations_state_check CHECK (
  (status = 'RESERVED' AND capture_transaction_id IS NULL AND release_transaction_id IS NULL AND captured_at IS NULL AND released_at IS NULL)
  OR (status = 'CAPTURED' AND capture_transaction_id IS NOT NULL AND release_transaction_id IS NULL AND captured_at IS NOT NULL AND released_at IS NULL AND captured_at >= reserved_at AND (captured_at < expires_at OR provider_started_at IS NOT NULL))
  OR (status = 'RELEASED' AND capture_transaction_id IS NULL AND release_transaction_id IS NOT NULL AND captured_at IS NULL AND released_at IS NOT NULL AND released_at >= reserved_at)
);

CREATE INDEX billing_usage_unsettled_submission_idx
  ON billing_usage_reservations (expires_at, id)
  WHERE status = 'RESERVED' AND provider_started_at IS NOT NULL;

CREATE FUNCTION billing_guard_usage_submission() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.provider_started_at IS NOT NULL AND NEW.provider_started_at IS DISTINCT FROM OLD.provider_started_at THEN
    RAISE EXCEPTION 'provider submission pin is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.provider_started_at IS NULL AND NEW.provider_started_at IS NOT NULL AND
    (OLD.status <> 'RESERVED' OR NEW.status <> 'RESERVED' OR OLD.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION 'cannot start an expired or settled provider reservation' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.review_decision IS DISTINCT FROM OLD.review_decision AND
    (OLD.review_decision IS NOT NULL OR OLD.provider_started_at IS NULL OR OLD.status <> 'RESERVED' OR NEW.status NOT IN ('CAPTURED', 'RELEASED')) THEN
    RAISE EXCEPTION 'financial review is immutable and requires final settlement' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_usage_submission_guard BEFORE UPDATE ON billing_usage_reservations
FOR EACH ROW EXECUTE FUNCTION billing_guard_usage_submission();
