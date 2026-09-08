-- Existing reservations keep their historical behaviour. New reservations
-- pin the subscription period so release cannot resurrect expired allowances.
ALTER TABLE billing_usage_reservations ADD COLUMN included_period_end TIMESTAMPTZ(6);
DO $$
DECLARE definition TEXT;
BEGIN
  definition := pg_get_functiondef('public.billing_guard_usage_reservation()'::regprocedure);
  IF position('NEW."included_amount_minor" IS DISTINCT FROM OLD."included_amount_minor"' IN definition) = 0
  THEN RAISE EXCEPTION 'Usage reservation immutability guard was not found'; END IF;
  EXECUTE replace(definition,
    'NEW."included_amount_minor" IS DISTINCT FROM OLD."included_amount_minor"',
    'NEW."included_amount_minor" IS DISTINCT FROM OLD."included_amount_minor" OR NEW."included_period_end" IS DISTINCT FROM OLD."included_period_end"');
END $$;
