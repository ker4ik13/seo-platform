-- Старые агенты продолжают остальные capability; paced crawl требует protocol v2.
CREATE OR REPLACE FUNCTION public.remote_worker_capability_capacity(p_node public.execution_worker_nodes,p_capability TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE WHEN p_capability = 'CRAWL' AND COALESCE((p_node).last_protocol_version, 1) < 2 THEN 0 ELSE GREATEST(0,LEAST(COALESCE(((p_node).capability_limits->>p_capability)::INTEGER,512),
    COALESCE(((p_node).reported_capability_slots->>p_capability)::INTEGER,CASE WHEN p_capability='RANK' THEN (p_node).reported_rank_slots ELSE 0 END),
    CASE WHEN p_capability IN ('IMPORT','EXPORT','INSPECTION') THEN LEAST((p_node).max_cpu_slots,(p_node).reported_cpu_slots) ELSE LEAST((p_node).max_http_slots,(p_node).reported_http_slots) END)) END
$$;
