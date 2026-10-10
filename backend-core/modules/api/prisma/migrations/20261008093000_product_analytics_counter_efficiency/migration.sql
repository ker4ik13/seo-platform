-- Timing-only events belong to metric aggregates. They must not produce extra
-- empty daily scope writes or qualify a human as active.
DO $$
DECLARE definition TEXT; updated TEXT;
BEGIN
  definition:=pg_get_functiondef('public.ingest_product_analytics(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
  updated:=replace(definition,'errors FROM events GROUP BY 1,2',
    'errors FROM events WHERE kind IN (''PAGE_VIEW'',''ACTION'',''RESULT_VIEW'',''CLIENT_ERROR'') GROUP BY 1,2');
  IF updated=definition THEN RAISE EXCEPTION 'Expected analytics counters boundary is missing'; END IF;
  definition:=updated;
  updated:=replace(definition,'kind,sum(count) count,sum(value) value FROM events GROUP BY 1,2,3',
    'kind,sum(count) count,sum(value) value FROM events WHERE kind IN (''API_TIMING'',''API_ERROR'',''LCP'',''CLS'',''INTERACTION'') GROUP BY 1,2,3');
  IF updated=definition THEN RAISE EXCEPTION 'Expected analytics metrics boundary is missing'; END IF;
  definition:=updated;
  updated:=replace(definition,'first_value_at=least(product_analytics_profiles.first_value_at,excluded.first_value_at);',
    'first_value_at=least(product_analytics_profiles.first_value_at,excluded.first_value_at)
     WHERE (product_analytics_profiles.is_internal,product_analytics_profiles.first_active_day,product_analytics_profiles.last_active_day,product_analytics_profiles.first_value_day,product_analytics_profiles.first_value_at)
       IS DISTINCT FROM (excluded.is_internal,least(product_analytics_profiles.first_active_day,excluded.first_active_day),greatest(product_analytics_profiles.last_active_day,excluded.last_active_day),least(product_analytics_profiles.first_value_day,excluded.first_value_day),least(product_analytics_profiles.first_value_at,excluded.first_value_at));');
  IF updated=definition THEN RAISE EXCEPTION 'Expected analytics profile transition is missing'; END IF;
  EXECUTE updated;
END $$;
CREATE INDEX product_analytics_profiles_created_idx ON product_analytics_profiles(created_at);
CREATE INDEX product_analytics_profiles_segment_created_idx ON product_analytics_profiles(is_internal,created_at);
CREATE INDEX users_analytics_internal_idx ON users(id) WHERE email_normalized LIKE '%@example.invalid';
CREATE INDEX platform_staff_analytics_active_idx ON platform_staff_role_assignments(user_id) WHERE revoked_at IS NULL;
CREATE INDEX billing_payments_analytics_succeeded_idx ON billing_payments(succeeded_at) WHERE is_test=FALSE AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED');
CREATE INDEX billing_refunds_analytics_succeeded_idx ON billing_refunds(succeeded_at) WHERE status='SUCCEEDED';
CREATE INDEX billing_refund_requests_analytics_succeeded_idx ON billing_refund_requests(updated_at) WHERE status='SUCCEEDED';
