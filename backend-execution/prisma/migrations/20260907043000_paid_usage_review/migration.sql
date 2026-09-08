BEGIN;
ALTER TABLE provider_usage_tickets
  ADD COLUMN resolution VARCHAR(16), ADD COLUMN resolved_at TIMESTAMPTZ(6),
  ADD COLUMN resolved_by UUID, ADD COLUMN resolution_reason VARCHAR(500),
  ADD COLUMN provider_reference VARCHAR(128), ADD COLUMN resolution_key VARCHAR(180),
  ADD CONSTRAINT provider_usage_review_shape CHECK (
    (resolution IS NULL AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_reason IS NULL AND provider_reference IS NULL AND resolution_key IS NULL)
    OR (resolution IN ('CHARGE', 'RELEASE') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL
      AND resolution_reason IS NOT NULL AND length(btrim(resolution_reason)) BETWEEN 5 AND 500
      AND resolution_key IS NOT NULL AND length(resolution_key) BETWEEN 8 AND 180
      AND state = 'UNKNOWN' AND started_at IS NOT NULL AND finished_at IS NOT NULL
      AND (resolution <> 'CHARGE' OR provider_reference IS NOT NULL)
      AND (provider_reference IS NULL OR provider_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{4,127}$'))
  );

CREATE OR REPLACE FUNCTION guard_provider_usage_ticket() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Provider usage evidence cannot be deleted'; END IF;
  IF (NEW.job_id, NEW.unit_key, NEW.part, NEW.item_ids, NEW.units_milli, NEW.created_at)
    IS DISTINCT FROM (OLD.job_id, OLD.unit_key, OLD.part, OLD.item_ids, OLD.units_milli, OLD.created_at)
    OR OLD.state = 'ACCEPTED' AND NEW IS DISTINCT FROM OLD
    OR OLD.resolved_at IS NOT NULL AND NEW IS DISTINCT FROM OLD
    OR OLD.state IN ('STARTED', 'UNKNOWN') AND (NEW.ticket_token <> OLD.ticket_token OR NEW.state NOT IN ('ACCEPTED', 'REJECTED', 'UNKNOWN'))
  THEN RAISE EXCEPTION 'Provider usage scope and accepted evidence are immutable'; END IF;
  IF NEW.resolved_at IS NOT NULL AND (
    OLD.state NOT IN ('STARTED', 'UNKNOWN') OR NEW.state <> 'UNKNOWN'
    OR (NEW.result, NEW.started_at, NEW.ticket_token, NEW.lease_owner, NEW.job_version, NEW.lease_expires_at, NEW.authorized_at)
       IS DISTINCT FROM (OLD.result, OLD.started_at, OLD.ticket_token, OLD.lease_owner, OLD.job_version, OLD.lease_expires_at, OLD.authorized_at)
  ) THEN RAISE EXCEPTION 'A financial review cannot manufacture provider result evidence'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_provider_usage_ticket() FROM PUBLIC;
COMMIT;
