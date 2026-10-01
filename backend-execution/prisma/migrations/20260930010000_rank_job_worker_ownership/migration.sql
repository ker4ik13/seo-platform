BEGIN;

CREATE TABLE public.rank_job_worker_assignments (
  job_id UUID PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES public.execution_worker_nodes(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0)
);
CREATE INDEX rank_job_worker_assignments_node_idx ON public.rank_job_worker_assignments(node_id);

-- A Job stays on one healthy node. Saturation shares that node's slots;
-- it does not make the main server race the delegated paid pages.
CREATE FUNCTION public.rank_job_poll_owner(p_job_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_node UUID;
BEGIN
  SELECT assignment.node_id INTO v_node
  FROM public.rank_job_worker_assignments assignment
  JOIN public.execution_worker_nodes node ON node.id = assignment.node_id
  WHERE assignment.job_id = p_job_id AND node.enabled AND NOT node.draining
    AND node.last_protocol_version = 1 AND 'RANK' = ANY(node.capabilities)
    AND LEAST(node.max_http_slots, node.reported_http_slots, node.reported_rank_slots) > 0
    AND node.last_heartbeat_at > clock_timestamp() - INTERVAL '30 seconds';
  IF FOUND THEN RETURN v_node; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.execution_worker_nodes node
    WHERE node.enabled AND NOT node.draining AND node.last_protocol_version = 1
      AND 'RANK' = ANY(node.capabilities)
      AND LEAST(node.max_http_slots, node.reported_http_slots, node.reported_rank_slots) > 0
      AND node.last_heartbeat_at > clock_timestamp() - INTERVAL '30 seconds') THEN
    RETURN NULL;
  END IF;
  -- Serialize only assignment/reassignment, never provider network I/O.
  PERFORM pg_advisory_xact_lock(hashtextextended('rank-owner:' || p_job_id::TEXT, 0));
  SELECT assignment.node_id INTO v_node
  FROM public.rank_job_worker_assignments assignment
  JOIN public.execution_worker_nodes node ON node.id = assignment.node_id
  WHERE assignment.job_id = p_job_id AND node.enabled AND NOT node.draining
    AND node.last_protocol_version = 1 AND 'RANK' = ANY(node.capabilities)
    AND LEAST(node.max_http_slots, node.reported_http_slots, node.reported_rank_slots) > 0
    AND node.last_heartbeat_at > clock_timestamp() - INTERVAL '30 seconds';
  IF FOUND THEN RETURN v_node; END IF;
  SELECT node.id INTO v_node FROM public.execution_worker_nodes node
  WHERE node.enabled AND NOT node.draining AND node.last_protocol_version = 1
    AND 'RANK' = ANY(node.capabilities)
    AND LEAST(node.max_http_slots, node.reported_http_slots, node.reported_rank_slots) > 0
    AND node.last_heartbeat_at > clock_timestamp() - INTERVAL '30 seconds'
  ORDER BY (SELECT COUNT(*)::FLOAT8 FROM public.rank_job_worker_assignments assignment
    JOIN public.jobs job ON job.id = assignment.job_id
    WHERE assignment.node_id = node.id AND job.status = 'RUNNING') /
    LEAST(node.max_http_slots, node.reported_http_slots, node.reported_rank_slots),
    node.active_work_items::FLOAT8 / LEAST(node.max_http_slots, node.reported_http_slots, node.reported_rank_slots), node.id
  LIMIT 1;
  IF v_node IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.rank_job_worker_assignments(job_id, node_id)
  VALUES (p_job_id, v_node)
  ON CONFLICT (job_id) DO UPDATE SET node_id = EXCLUDED.node_id,
    assigned_at = clock_timestamp(), generation = rank_job_worker_assignments.generation + 1;
  RETURN v_node;
END $$;

CREATE FUNCTION public.rank_poll_owner_matches(p_job_id UUID, p_lease_owner TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_requested UUID;
BEGIN
  IF p_lease_owner ~ '^remote:[0-9a-f-]{36}:[0-9a-f-]{36}$' THEN
    v_requested := split_part(p_lease_owner, ':', 2)::UUID;
  ELSIF p_lease_owner LIKE 'remote:%' THEN RETURN FALSE;
  END IF;
  RETURN public.rank_job_poll_owner(p_job_id) IS NOT DISTINCT FROM v_requested;
END $$;

-- Keep the existing fairness/lease graph; filter before LIMIT and recheck
-- inside the atomic targeted claim (a cached candidate is not authority).
DO $migration$
DECLARE definition TEXT; needle TEXT;
BEGIN
  SELECT pg_get_functiondef('public.list_rank_connector_poll_candidates(text,integer,uuid[])'::regprocedure) INTO definition;
  definition := replace(definition,
    'list_rank_connector_poll_candidates(p_execution_connector_version text, p_limit integer, p_excluded uuid[])',
    'list_rank_connector_poll_candidates_for_worker(p_execution_connector_version text, p_limit integer, p_excluded uuid[], p_lease_owner text)');
  needle := 'AND execution.id <> ALL(p_excluded)';
  IF position(needle IN definition) = 0 THEN RAISE EXCEPTION 'Poll candidates drifted'; END IF;
  definition := replace(definition, 'WITH active_fetches AS MATERIALIZED (',
    'WITH eligible_owners AS MATERIALIZED (' || E'\n'
    || 'SELECT job.id FROM public.jobs job WHERE job.type = ''MANUAL_RANK_CHECK''' || E'\n'
    || 'AND job.provider = ''XMLSTOCK'' AND job.status = ''RUNNING''' || E'\n'
    || 'AND job.cancel_requested_at IS NULL AND public.rank_poll_owner_matches(job.id, p_lease_owner)' || E'\n'
    || '), active_fetches AS MATERIALIZED (');
  definition := replace(definition, needle, needle || E'\n      AND execution.job_id IN (SELECT id FROM eligible_owners)');
  EXECUTE definition;

  SELECT pg_get_functiondef('public.claim_rank_connector_poll_targeted(text,integer,text,uuid)'::regprocedure) INTO definition;
  needle := 'WHERE execution.id = p_execution_id';
  IF position(needle IN definition) = 0 THEN RAISE EXCEPTION 'Poll claim drifted'; END IF;
  EXECUTE replace(definition, needle, needle || E'\n    AND public.rank_poll_owner_matches(execution.job_id, p_lease_owner)');
END $migration$;

REVOKE ALL ON FUNCTION public.rank_job_poll_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rank_poll_owner_matches(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_rank_connector_poll_candidates_for_worker(TEXT, INTEGER, UUID[], TEXT) FROM PUBLIC;

-- Show the stable assignment during provider wait, not only during a GET.
CREATE OR REPLACE FUNCTION public.list_remote_worker_rank_assignments(p_limit INTEGER)
RETURNS TABLE ("nodeId" TEXT, "jobId" UUID, "searchEngine" TEXT, "activeTasks" BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid worker assignment limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY WITH activity AS (
    SELECT CASE WHEN execution.lease_owner ~ '^remote:[0-9a-f-]{36}:[0-9a-f-]{36}$'
      THEN split_part(execution.lease_owner, ':', 2) ELSE 'main' END AS node_id,
      execution.job_id, intent.request_snapshot #>> '{execution,searchEngine}' AS engine,
      COUNT(*)::BIGINT AS tasks
    FROM public.rank_connector_executions execution
    JOIN public.rank_provider_request_intents intent ON intent.id = execution.provider_request_intent_id
      AND intent.workspace_id = execution.workspace_id AND intent.request_hash = execution.provider_request_intent_hash
    WHERE execution.status IN ('SUBMITTING', 'FETCHING')
      AND execution.lease_expires_at > clock_timestamp() AND execution.lease_owner IS NOT NULL
    GROUP BY 1, 2, 3
    UNION ALL
    SELECT assignment.node_id::TEXT, assignment.job_id,
      job.input_snapshot #>> '{execution,searchEngine}', 0::BIGINT
    FROM public.rank_job_worker_assignments assignment
    JOIN public.jobs job ON job.id = assignment.job_id
    JOIN public.execution_worker_nodes node ON node.id = assignment.node_id
    WHERE job.status = 'RUNNING' AND job.cancel_requested_at IS NULL
      AND node.enabled AND NOT node.draining
      AND node.last_heartbeat_at > clock_timestamp() - INTERVAL '30 seconds'
  ) SELECT activity.node_id, activity.job_id,
      CASE WHEN activity.engine IN ('YANDEX', 'GOOGLE') THEN activity.engine END,
      SUM(activity.tasks)::BIGINT
    FROM activity GROUP BY 1, 2, 3 LIMIT p_limit;
END $$;
COMMIT;
