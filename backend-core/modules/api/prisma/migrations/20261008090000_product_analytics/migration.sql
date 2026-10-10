CREATE TABLE product_analytics_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  first_active_day DATE, last_active_day DATE, first_value_day DATE, first_value_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX product_analytics_profiles_cohort_idx ON product_analytics_profiles(first_active_day,is_internal);
CREATE TABLE product_analytics_daily (
  day DATE NOT NULL, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_key TEXT NOT NULL, section VARCHAR(24) NOT NULL,
  workspace_id UUID, project_id UUID,
  active_seconds BIGINT NOT NULL DEFAULT 0 CHECK(active_seconds BETWEEN 0 AND 86400),
  views BIGINT NOT NULL DEFAULT 0, actions BIGINT NOT NULL DEFAULT 0,
  results BIGINT NOT NULL DEFAULT 0, sessions BIGINT NOT NULL DEFAULT 0, errors BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY(day,user_id,scope_key)
);
CREATE INDEX product_analytics_daily_report_idx ON product_analytics_daily(scope_key,day,user_id);
CREATE INDEX product_analytics_daily_user_idx ON product_analytics_daily(user_id,day);
CREATE TABLE product_analytics_buckets (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  minute_at TIMESTAMPTZ NOT NULL, scope_key TEXT NOT NULL,
  active_mask BIGINT NOT NULL CHECK(active_mask >= 0),
  PRIMARY KEY(user_id,minute_at,scope_key)
);
CREATE INDEX product_analytics_buckets_retention_idx ON product_analytics_buckets(minute_at,user_id);
CREATE TABLE product_analytics_receipts (
  event_id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX product_analytics_receipts_retention_idx ON product_analytics_receipts(occurred_at,event_id);
CREATE INDEX product_analytics_receipts_user_idx ON product_analytics_receipts(user_id);
CREATE TABLE product_analytics_sessions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL, last_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(user_id,session_id)
);
CREATE INDEX product_analytics_sessions_recent_idx ON product_analytics_sessions(last_at,user_id);
CREATE TABLE product_analytics_metrics (
  day DATE NOT NULL, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section VARCHAR(24) NOT NULL, kind VARCHAR(24) NOT NULL,
  count BIGINT NOT NULL DEFAULT 0, total_value BIGINT NOT NULL DEFAULT 0,
  histogram JSONB NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0]',
  PRIMARY KEY(day,user_id,section,kind)
);
CREATE INDEX product_analytics_metrics_user_idx ON product_analytics_metrics(user_id);

CREATE FUNCTION product_analytics_add_histogram(left_value JSONB,right_value JSONB)
RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_agg(coalesce((left_value->>ordinal)::bigint,0)+coalesce((right_value->>ordinal)::bigint,0) ORDER BY ordinal)
  FROM generate_series(0,10) ordinal
$$;

-- One authenticated batch is persisted by one function call. A per-user lock serializes
-- overlapping tabs/devices; bitmap union counts each active second once.
CREATE FUNCTION ingest_product_analytics(p_user UUID,p_session UUID,p_scope JSONB,p_intervals JSONB,p_events JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE accepted UUID[]; session_is_new BOOLEAN; first_at TIMESTAMPTZ; last_at TIMESTAMPTZ; value_at TIMESTAMPTZ; internal_user BOOLEAN;
BEGIN
  IF jsonb_typeof(p_intervals)<>'array' OR jsonb_typeof(p_events)<>'array'
    OR jsonb_array_length(p_intervals)>32 OR jsonb_array_length(p_events)>32
    OR octet_length(p_scope::text)+octet_length(p_intervals::text)+octet_length(p_events::text)>131072 THEN
    RAISE EXCEPTION 'Invalid product analytics batch' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('product-analytics:'||p_user::text,0));
  SELECT EXISTS(SELECT 1 FROM public.platform_staff_role_assignments a WHERE a.user_id=p_user AND a.revoked_at IS NULL)
      OR u.email_normalized LIKE '%@example.invalid' INTO internal_user FROM public.users u WHERE u.id=p_user AND u.status='ACTIVE';
  IF NOT FOUND THEN RETURN 0; END IF;
  WITH inserted AS (
    INSERT INTO public.product_analytics_receipts(event_id,user_id,occurred_at)
    SELECT (item->>'id')::uuid,p_user,(item->>'occurredAt')::timestamptz
    FROM (SELECT value item FROM jsonb_array_elements(p_intervals) UNION ALL SELECT value FROM jsonb_array_elements(p_events)) source
    ON CONFLICT DO NOTHING RETURNING event_id
  ) SELECT array_agg(event_id) INTO accepted FROM inserted;
  IF accepted IS NULL THEN RETURN 0; END IF;
  SELECT min((item->>'occurredAt')::timestamptz),max((item->>'endedAt')::timestamptz)
    INTO first_at,last_at FROM jsonb_array_elements(p_intervals) item WHERE (item->>'id')::uuid=ANY(accepted);
  IF first_at IS NULL THEN SELECT min((item->>'occurredAt')::timestamptz) INTO first_at FROM jsonb_array_elements(p_events) item WHERE (item->>'id')::uuid=ANY(accepted); END IF;
  last_at:=coalesce(last_at,first_at);
  SELECT NOT EXISTS(SELECT 1 FROM public.product_analytics_sessions WHERE user_id=p_user AND session_id=p_session) INTO session_is_new;
  INSERT INTO public.product_analytics_sessions VALUES(p_user,p_session,first_at,last_at)
    ON CONFLICT(user_id,session_id) DO UPDATE SET last_at=greatest(product_analytics_sessions.last_at,excluded.last_at);

  WITH incoming AS MATERIALIZED (
    SELECT (mask->>'minuteAt')::timestamptz minute_at,mask->>'scopeKey' scope_key,mask->>'section' section,
      bit_or((mask->>'mask')::bigint) active_mask
    FROM jsonb_array_elements(p_intervals) item CROSS JOIN LATERAL jsonb_array_elements(item->'masks') mask
    WHERE (item->>'id')::uuid=ANY(accepted) GROUP BY 1,2,3
  ), previous AS MATERIALIZED (
    SELECT i.*,coalesce(b.active_mask,0) previous_mask FROM incoming i
    LEFT JOIN public.product_analytics_buckets b ON b.user_id=p_user AND b.minute_at=i.minute_at AND b.scope_key=i.scope_key
  ), saved AS (
    INSERT INTO public.product_analytics_buckets(user_id,minute_at,scope_key,active_mask)
    SELECT p_user,minute_at,scope_key,active_mask FROM previous
    ON CONFLICT(user_id,minute_at,scope_key) DO UPDATE SET active_mask=product_analytics_buckets.active_mask|excluded.active_mask
    RETURNING minute_at,scope_key
  )
  INSERT INTO public.product_analytics_daily(day,user_id,scope_key,section,workspace_id,project_id,active_seconds)
  SELECT (p.minute_at AT TIME ZONE 'UTC')::date,p_user,p.scope_key,p.section,
    CASE WHEN p.scope_key='all' THEN NULL ELSE (p_scope->>'workspaceId')::uuid END,
    CASE WHEN p.scope_key='all' THEN NULL ELSE (p_scope->>'projectId')::uuid END,
    sum(bit_count((p.active_mask|p.previous_mask)::bit(64))-bit_count(p.previous_mask::bit(64)))
  FROM previous p JOIN saved s USING(minute_at,scope_key) GROUP BY 1,2,3,4,5,6
  ON CONFLICT(day,user_id,scope_key) DO UPDATE SET active_seconds=product_analytics_daily.active_seconds+excluded.active_seconds;

  WITH events AS MATERIALIZED (
    SELECT (item->>'occurredAt')::timestamptz occurred_at,item->>'section' section,item->>'kind' kind,
      (item->>'count')::bigint count,(item->>'value')::bigint value,
      coalesce(item->'histogram','[0,0,0,0,0,0,0,0,0,0,0]'::jsonb) histogram
    FROM jsonb_array_elements(p_events) item WHERE (item->>'id')::uuid=ANY(accepted)
  ), counters AS (
    SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day,section,
      sum(CASE WHEN kind='PAGE_VIEW' THEN count ELSE 0 END) views,
      sum(CASE WHEN kind='ACTION' THEN count ELSE 0 END) actions,
      sum(CASE WHEN kind='RESULT_VIEW' THEN count ELSE 0 END) results,
      sum(CASE WHEN kind='CLIENT_ERROR' THEN count ELSE 0 END) errors FROM events GROUP BY 1,2
  ), scoped AS (
    SELECT day,'all' scope_key,'ALL' section,NULL::uuid workspace_id,NULL::uuid project_id,
      sum(views) views,sum(actions) actions,sum(results) results,sum(errors) errors FROM counters GROUP BY day
    UNION ALL SELECT day,section||':'||coalesce(p_scope->>'workspaceId','')||':'||coalesce(p_scope->>'projectId',''),section,
      (p_scope->>'workspaceId')::uuid,(p_scope->>'projectId')::uuid,views,actions,results,errors FROM counters
  ), saved AS (
    INSERT INTO public.product_analytics_daily(day,user_id,scope_key,section,workspace_id,project_id,views,actions,results,errors)
    SELECT day,p_user,scope_key,section,workspace_id,project_id,views,actions,results,errors FROM scoped
    ON CONFLICT(day,user_id,scope_key) DO UPDATE SET views=product_analytics_daily.views+excluded.views,
      actions=product_analytics_daily.actions+excluded.actions,results=product_analytics_daily.results+excluded.results,
      errors=product_analytics_daily.errors+excluded.errors RETURNING day
  ), grouped AS (
    SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day,section,kind,sum(count) count,sum(value) value FROM events GROUP BY 1,2,3
  )
  INSERT INTO public.product_analytics_metrics(day,user_id,section,kind,count,total_value,histogram)
  SELECT g.day,p_user,g.section,g.kind,g.count,g.value,
    (SELECT jsonb_agg(bin.total ORDER BY bin.ordinal) FROM (
      SELECT ordinal,sum(coalesce((e.histogram->>ordinal)::bigint,0)) total FROM events e CROSS JOIN generate_series(0,10) ordinal
      WHERE (e.occurred_at AT TIME ZONE 'UTC')::date=g.day AND e.section=g.section AND e.kind=g.kind GROUP BY ordinal
    ) bin) FROM grouped g
  ON CONFLICT(day,user_id,section,kind) DO UPDATE SET count=product_analytics_metrics.count+excluded.count,
    total_value=product_analytics_metrics.total_value+excluded.total_value,
    histogram=public.product_analytics_add_histogram(product_analytics_metrics.histogram,excluded.histogram);

  IF session_is_new THEN
    INSERT INTO public.product_analytics_daily(day,user_id,scope_key,section,sessions) VALUES((first_at AT TIME ZONE 'UTC')::date,p_user,'all','ALL',1)
      ON CONFLICT(day,user_id,scope_key) DO UPDATE SET sessions=product_analytics_daily.sessions+1;
  END IF;
  SELECT min((item->>'occurredAt')::timestamptz) INTO value_at FROM jsonb_array_elements(p_events) item WHERE item->>'kind'='RESULT_VIEW' AND (item->>'id')::uuid=ANY(accepted);
  INSERT INTO public.product_analytics_profiles(user_id,is_internal,first_active_day,last_active_day,first_value_day,first_value_at)
  SELECT p_user,internal_user,min(day) FILTER(WHERE active_seconds>=30 OR actions>0 OR results>0),
    max(day) FILTER(WHERE active_seconds>=30 OR actions>0 OR results>0),min(day) FILTER(WHERE results>0),value_at
  FROM public.product_analytics_daily WHERE user_id=p_user AND scope_key='all' AND day>=(clock_timestamp()-interval '2 days')::date
  ON CONFLICT(user_id) DO UPDATE SET is_internal=excluded.is_internal,
    first_active_day=least(product_analytics_profiles.first_active_day,excluded.first_active_day),
    last_active_day=greatest(product_analytics_profiles.last_active_day,excluded.last_active_day),
    first_value_day=least(product_analytics_profiles.first_value_day,excluded.first_value_day),
    first_value_at=least(product_analytics_profiles.first_value_at,excluded.first_value_at);
  RETURN cardinality(accepted);
END $$;
REVOKE ALL ON FUNCTION ingest_product_analytics(UUID,UUID,JSONB,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION product_analytics_add_histogram(JSONB,JSONB) FROM PUBLIC;

CREATE INDEX IF NOT EXISTS users_created_analytics_idx ON users(created_at,id);
CREATE INDEX IF NOT EXISTS workspaces_created_analytics_idx ON workspaces(created_at,id);
CREATE INDEX IF NOT EXISTS projects_created_analytics_idx ON projects(created_at,id);
CREATE INDEX IF NOT EXISTS users_verified_analytics_idx ON users(email_verified_at) WHERE email_verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS workspace_invites_created_analytics_idx ON workspace_invites(created_at);
CREATE INDEX IF NOT EXISTS workspace_invites_accepted_analytics_idx ON workspace_invites(accepted_at) WHERE accepted_at IS NOT NULL;
