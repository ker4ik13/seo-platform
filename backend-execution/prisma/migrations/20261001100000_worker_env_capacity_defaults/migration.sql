BEGIN;

-- Existing nodes retain their explicitly stored administrative settings.
-- New nodes inherit the agent's .env until an administrator saves a manual
-- capacity configuration.
ALTER TABLE public.execution_worker_nodes
  ADD COLUMN uses_env_capacity BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE signature REGPROCEDURE; definition TEXT; updated TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.claim_remote_work(uuid,integer,integer,jsonb)'::regprocedure,
    'public.enqueue_remote_work(jsonb,text,text,text,jsonb,text,integer)'::regprocedure,
    'public.remote_worker_http_capacity(uuid)'::regprocedure
  ] LOOP
    definition := pg_get_functiondef(signature);
    updated := replace(definition,
      'LEAST(v_node.max_http_slots,v_node.reported_http_slots)',
      '(CASE WHEN v_node.uses_env_capacity THEN LEAST(v_node.max_http_slots,v_node.reported_http_slots) ELSE v_node.max_http_slots END)');
    updated := replace(updated,
      'LEAST(v_node.max_cpu_slots,v_node.reported_cpu_slots)',
      '(CASE WHEN v_node.uses_env_capacity THEN LEAST(v_node.max_cpu_slots,v_node.reported_cpu_slots) ELSE v_node.max_cpu_slots END)');
    updated := replace(updated,
      'LEAST(n.max_http_slots,n.reported_http_slots)',
      '(CASE WHEN n.uses_env_capacity THEN LEAST(n.max_http_slots,n.reported_http_slots) ELSE n.max_http_slots END)');
    updated := replace(updated,
      'LEAST(n.max_cpu_slots,n.reported_cpu_slots)',
      '(CASE WHEN n.uses_env_capacity THEN LEAST(n.max_cpu_slots,n.reported_cpu_slots) ELSE n.max_cpu_slots END)');
    IF updated = definition THEN RAISE EXCEPTION 'Expected worker capacity boundary was not found: %', signature; END IF;
    EXECUTE updated;
  END LOOP;

  signature := 'public.remote_worker_capability_capacity(public.execution_worker_nodes,text)'::regprocedure;
  definition := pg_get_functiondef(signature);
  updated := replace(definition,
    'COALESCE(((p_node).reported_capability_slots->>p_capability)::INTEGER,CASE WHEN p_capability=''RANK'' THEN (p_node).reported_rank_slots ELSE 0 END)',
    '(CASE WHEN (p_node).uses_env_capacity THEN COALESCE(((p_node).reported_capability_slots->>p_capability)::INTEGER,CASE WHEN p_capability=''RANK'' THEN (p_node).reported_rank_slots ELSE 0 END) ELSE 512 END)');
  updated := replace(updated,
    'LEAST((p_node).max_cpu_slots,(p_node).reported_cpu_slots)',
    '(CASE WHEN (p_node).uses_env_capacity THEN LEAST((p_node).max_cpu_slots,(p_node).reported_cpu_slots) ELSE (p_node).max_cpu_slots END)');
  updated := replace(updated,
    'LEAST((p_node).max_http_slots,(p_node).reported_http_slots)',
    '(CASE WHEN (p_node).uses_env_capacity THEN LEAST((p_node).max_http_slots,(p_node).reported_http_slots) ELSE (p_node).max_http_slots END)');
  IF updated = definition OR position('uses_env_capacity' IN updated) = 0 THEN
    RAISE EXCEPTION 'Expected capability capacity boundary was not found';
  END IF;
  EXECUTE updated;

  signature := 'public.available_remote_rank_slots(integer)'::regprocedure;
  definition := pg_get_functiondef(signature);
  updated := replace(definition,
    E'LEAST(\n    node.max_http_slots,\n    node.reported_http_slots,\n    node.reported_rank_slots\n  )',
    'public.remote_worker_capability_capacity(node, ''RANK'')');
  IF updated = definition THEN RAISE EXCEPTION 'Expected rank capacity boundary was not found'; END IF;
  EXECUTE updated;
END $$;

COMMIT;
