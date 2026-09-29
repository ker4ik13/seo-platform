BEGIN;

CREATE FUNCTION public.available_remote_rank_slots(p_max_slots INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_slots BIGINT;
BEGIN
  IF p_max_slots IS NULL OR p_max_slots NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'Invalid remote rank slot ceiling'
      USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(SUM(LEAST(
    node.max_http_slots,
    node.reported_http_slots,
    node.reported_rank_slots
  )), 0)
  INTO v_slots
  FROM public.execution_worker_nodes node
  WHERE node.enabled
    AND NOT node.draining
    AND node.last_protocol_version = 1
    AND node.last_heartbeat_at > clock_timestamp() - INTERVAL '30 seconds'
    AND 'RANK' = ANY(node.capabilities);
  RETURN LEAST(p_max_slots::BIGINT, v_slots)::INTEGER;
END
$$;

REVOKE ALL ON FUNCTION public.available_remote_rank_slots(INTEGER)
  FROM PUBLIC;

COMMIT;
