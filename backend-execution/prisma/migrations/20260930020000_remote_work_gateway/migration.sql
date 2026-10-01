BEGIN;

ALTER TABLE public.execution_worker_nodes ADD COLUMN reported_capability_slots JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.execution_worker_nodes ADD COLUMN capability_limits JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE public.remote_operation_assignments (
  operation_id UUID NOT NULL, capability VARCHAR(24) NOT NULL,
  workspace_id UUID NOT NULL, project_id UUID,job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES public.execution_worker_nodes(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(operation_id, capability)
);
CREATE INDEX remote_operation_assignments_node_idx ON public.remote_operation_assignments(node_id);
CREATE INDEX remote_operation_assignments_job_idx ON public.remote_operation_assignments(job_id);

CREATE TABLE public.remote_work_tasks (
  id UUID PRIMARY KEY DEFAULT uuidv7(), workspace_id UUID NOT NULL, project_id UUID,
  operation_id UUID NOT NULL, job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES public.execution_worker_nodes(id) ON DELETE RESTRICT,
  capability VARCHAR(24) NOT NULL CHECK(capability IN ('RANK','WORDSTAT','RESEARCH','AI_ANSWER','CLUSTERING','CRAWL','IMPORT','EXPORT','INSPECTION')),
  command VARCHAR(32) NOT NULL CHECK(command IN ('PROVIDER_HTTP','CRAWL_RESOURCE','IMPORT_ROWS','EXPORT_FILE','UPLOAD_INSPECTION')),
  resource VARCHAR(8) NOT NULL CHECK(resource IN ('HTTP','CPU')),
  source_scope JSONB NOT NULL, payload JSONB NOT NULL, payload_hash CHAR(64) NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint CHAR(64) NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','CLAIMED','COMPLETED','FAILED','ABANDONED')),
  read_token_hash BYTEA NOT NULL, lease_token UUID NOT NULL DEFAULT gen_random_uuid(),
  execution_deadline TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  claimed_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, result JSONB, result_hash CHAR(64), error_code VARCHAR(64),
  result_object_key TEXT, result_multipart_id TEXT,
  CHECK(jsonb_typeof(source_scope) = 'object' AND jsonb_typeof(payload) = 'object'),
  CHECK((command='PROVIDER_HTTP' AND capability IN ('RANK','WORDSTAT','RESEARCH','AI_ANSWER','CLUSTERING') AND resource='HTTP') OR
    (command='CRAWL_RESOURCE' AND capability='CRAWL' AND resource='HTTP') OR
    (command='IMPORT_ROWS' AND capability='IMPORT' AND resource='CPU') OR
    (command='EXPORT_FILE' AND capability='EXPORT' AND resource='CPU') OR
    (command='UPLOAD_INSPECTION' AND capability='INSPECTION' AND resource='CPU')),
  CHECK((state = 'COMPLETED') = (result IS NOT NULL AND result_hash IS NOT NULL)),
  CHECK(state NOT IN ('COMPLETED','FAILED','ABANDONED') OR finished_at IS NOT NULL)
);
CREATE INDEX remote_work_tasks_node_state_created_idx ON public.remote_work_tasks(node_id,state,created_at);
CREATE INDEX remote_work_tasks_operation_state_idx ON public.remote_work_tasks(operation_id,state);
CREATE INDEX remote_work_tasks_state_deadline_idx ON public.remote_work_tasks(state,execution_deadline);
CREATE INDEX remote_work_tasks_ambiguous_idx ON public.remote_work_tasks(operation_id,request_fingerprint)
  WHERE state='FAILED' AND error_code='WORKER_OUTCOME_UNKNOWN';
CREATE INDEX remote_work_tasks_completed_http_idx ON public.remote_work_tasks(operation_id,request_fingerprint,created_at DESC)
  WHERE state='COMPLETED' AND command='PROVIDER_HTTP';
CREATE INDEX rank_remote_fetch_owner_idx ON public.rank_connector_executions(lease_owner,lease_expires_at)
  WHERE status = 'FETCHING' AND lease_owner LIKE 'remote:%';

CREATE FUNCTION public.remote_worker_capability_capacity(p_node public.execution_worker_nodes,p_capability TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT GREATEST(0,LEAST(COALESCE(((p_node).capability_limits->>p_capability)::INTEGER,512),
    COALESCE(((p_node).reported_capability_slots->>p_capability)::INTEGER,CASE WHEN p_capability='RANK' THEN (p_node).reported_rank_slots ELSE 0 END),
    CASE WHEN p_capability IN ('IMPORT','EXPORT','INSPECTION') THEN LEAST((p_node).max_cpu_slots,(p_node).reported_cpu_slots) ELSE LEAST((p_node).max_http_slots,(p_node).reported_http_slots) END))
$$;

-- The caller must prove the current owning workflow lease. A worker never
-- receives an arbitrary credential/file by choosing a workspace or object ID.
CREATE FUNCTION public.remote_work_scope_active(p_scope JSONB, p_capability TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE v_workspace UUID; v_project UUID; v_operation UUID; v_job UUID;
BEGIN
  v_workspace := (p_scope->>'workspaceId')::UUID;
  v_project := (p_scope->>'projectId')::UUID;
  v_operation := (p_scope->>'operationId')::UUID;
  v_job := (p_scope->>'jobId')::UUID;
  IF v_workspace IS NULL OR v_operation IS NULL THEN RETURN FALSE; END IF;
  IF p_scope->>'origin' = 'IMPORT' AND p_capability = 'IMPORT' THEN
    RETURN EXISTS(SELECT 1 FROM public.semantic_imports i WHERE i.id = v_operation
      AND i.workspace_id = v_workspace AND i.project_id = v_project
      AND i.status = 'PARSING' AND i.parsing_started_at = (p_scope->>'claimedAt')::TIMESTAMPTZ);
  ELSIF p_scope->>'origin' = 'UPLOAD' AND p_capability = 'INSPECTION' THEN
    RETURN EXISTS(SELECT 1 FROM public.uploads u WHERE u.id = v_operation AND u.workspace_id = v_workspace
      AND u.project_id IS NOT DISTINCT FROM v_project AND u.status = 'SCANNING'
      AND u.inspection_started_at = (p_scope->>'claimedAt')::TIMESTAMPTZ);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.id = v_job AND j.workspace_id = v_workspace
    AND j.project_id IS NOT DISTINCT FROM v_project AND j.status = 'RUNNING' AND j.cancel_requested_at IS NULL) THEN RETURN FALSE; END IF;
  IF p_scope->>'origin' = 'RANK' AND p_capability = 'RANK' THEN
    IF v_operation<>v_job THEN RETURN FALSE; END IF;
    RETURN EXISTS(SELECT 1 FROM public.rank_connector_executions e WHERE e.id = (p_scope->>'executionId')::UUID
      AND e.job_id = v_job AND e.workspace_id = v_workspace AND e.credential_id = (p_scope->>'credentialId')::UUID
      AND e.status IN ('SUBMITTING','FETCHING') AND e.lease_owner = p_scope->>'leaseOwner'
      AND e.lease_token = (p_scope->>'leaseToken')::UUID AND e.lease_expires_at > clock_timestamp());
  ELSIF p_scope->>'origin' = 'RESEARCH' AND p_capability = 'RESEARCH' THEN
    RETURN EXISTS(SELECT 1 FROM public.keyword_research_runs r WHERE r.id = v_operation AND r.job_id = v_job
      AND r.workspace_id = v_workspace AND r.project_id = v_project
      AND r.credential_id = (p_scope->>'credentialId')::UUID AND r.lease_owner = p_scope->>'leaseOwner'
      AND r.lease_token = (p_scope->>'leaseToken')::UUID AND r.lease_expires_at > clock_timestamp());
  ELSIF p_scope->>'origin' = 'JOB' THEN
    IF p_capability='CRAWL' THEN
      IF NOT EXISTS(SELECT 1 FROM public.technical_crawls c WHERE c.id=v_operation AND c.job_id=v_job AND c.workspace_id=v_workspace AND c.project_id=v_project) THEN RETURN FALSE; END IF;
    ELSIF v_operation<>v_job THEN RETURN FALSE;
    END IF;
    RETURN EXISTS(SELECT 1 FROM public.jobs j WHERE j.id = v_job AND j.lease_owner = p_scope->>'leaseOwner'
      AND j.lease_expires_at > clock_timestamp() AND
      ((p_capability = 'WORDSTAT' AND j.type = 'FREQUENCY_COLLECTION') OR
       (p_capability = 'AI_ANSWER' AND j.type = 'AI_ANSWER_COLLECTION') OR
       (p_capability = 'CLUSTERING' AND j.type = 'CLUSTERING_RUN') OR
       (p_capability = 'EXPORT' AND j.type = 'SEMANTIC_EXPORT') OR
       (p_capability = 'CRAWL' AND j.type = 'TECHNICAL_CRAWL'))
      AND (p_capability IN ('EXPORT','CRAWL') OR (j.scope_snapshot->>'credentialId' = p_scope->>'credentialId' AND j.provider=p_scope->>'provider')));
  END IF;
  RETURN FALSE;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN RETURN FALSE;
END $$;

CREATE FUNCTION public.list_remote_work_assignments(p_limit INTEGER,p_job_ids UUID[])
RETURNS TABLE("nodeId" TEXT,"jobId" UUID,"operationId" UUID,"capability" TEXT,"searchEngine" TEXT,"activeTasks" BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 1000 OR (p_job_ids IS NOT NULL AND cardinality(p_job_ids)>1000) THEN
    RAISE EXCEPTION 'Invalid assignment window' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT a.node_id::TEXT,COALESCE(a.job_id,a.operation_id),a.operation_id,a.capability::TEXT,
    CASE WHEN j.scope_snapshot->>'searchEngine' IN ('YANDEX','GOOGLE') THEN j.scope_snapshot->>'searchEngine'
      WHEN a.capability IN ('WORDSTAT','RESEARCH') AND j.provider IN ('XMLSTOCK','ARSENKIN') THEN 'YANDEX' END,
    COUNT(t.id)::BIGINT
    FROM public.remote_operation_assignments a JOIN public.execution_worker_nodes n ON n.id=a.node_id
    LEFT JOIN public.jobs j ON j.id=a.job_id
    LEFT JOIN public.remote_work_tasks t ON t.node_id=a.node_id AND t.operation_id=a.operation_id AND t.capability=a.capability
      AND t.state='CLAIMED' AND t.execution_deadline>clock_timestamp()
    WHERE n.enabled AND NOT n.draining AND n.last_heartbeat_at>clock_timestamp()-INTERVAL '30 seconds'
      AND a.capability=ANY(n.capabilities) AND public.remote_worker_capability_capacity(n,a.capability)>0
      AND (p_job_ids IS NULL OR a.job_id=ANY(p_job_ids)) AND (
        (j.status IN ('RUNNING','QUEUED','RETRY_SCHEDULED','WAITING_RATE_LIMIT') AND j.cancel_requested_at IS NULL) OR
        (a.capability='IMPORT' AND EXISTS(SELECT 1 FROM public.semantic_imports i WHERE i.id=a.operation_id AND i.status='PARSING')) OR
        (a.capability='INSPECTION' AND EXISTS(SELECT 1 FROM public.uploads u WHERE u.id=a.operation_id AND u.status='SCANNING')))
    GROUP BY a.node_id,a.job_id,a.operation_id,a.capability,j.scope_snapshot,j.provider LIMIT p_limit;
END $$;

CREATE FUNCTION public.enqueue_remote_work(p_scope JSONB,p_capability TEXT,p_command TEXT,p_resource TEXT,p_payload JSONB,p_hash TEXT,p_timeout_ms INTEGER)
RETURNS TABLE("id" UUID,"readToken" UUID,"nodeId" UUID,"blocked" BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE v_node UUID; v_id UUID; v_token UUID := gen_random_uuid(); v_operation UUID := (p_scope->>'operationId')::UUID; v_fingerprint TEXT; v_existing public.remote_work_tasks%ROWTYPE; v_paid BOOLEAN;
BEGIN
  IF p_hash !~ '^[a-f0-9]{64}$' OR p_timeout_ms NOT BETWEEN 1000 AND 3600000 OR
    p_resource NOT IN ('HTTP','CPU') OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::TEXT) > 2097152 THEN
    RAISE EXCEPTION 'Invalid remote work envelope' USING ERRCODE = '22023';
  END IF;
  IF NOT public.remote_work_scope_active(p_scope,p_capability) THEN
    RAISE EXCEPTION 'Remote source lease is unavailable' USING ERRCODE = '40001';
  END IF;
  v_fingerprint:=encode(sha256(convert_to((p_payload-'admitBefore'-'timeoutMs'-'maxBytes')::TEXT || ':' || COALESCE(p_scope->>'physicalKeyScopeId','') || ':' || COALESCE(p_scope->>'credentialFingerprint',''),'UTF8')),'hex');
  v_paid:=p_command='PROVIDER_HTTP' AND (p_payload->>'url' LIKE 'https://arsenkin.ru/api/tools/set%' OR
      p_payload->>'url' LIKE 'https://api.keys.so/%' OR
      (p_payload->>'url' LIKE 'https://xmlstock.com/%' AND p_payload->>'url' !~ '[?&]reqid='));
  IF v_paid THEN
    SELECT * INTO v_existing FROM public.remote_work_tasks t WHERE t.operation_id=v_operation AND t.request_fingerprint=v_fingerprint
      AND t.command='PROVIDER_HTTP' AND t.state='COMPLETED' ORDER BY t.created_at DESC LIMIT 1;
    IF FOUND THEN RETURN QUERY SELECT v_existing.id,v_existing.lease_token,v_existing.node_id,FALSE; RETURN; END IF;
  END IF;
  IF v_paid AND
    (SELECT COUNT(*) FROM public.remote_work_tasks t WHERE t.operation_id=v_operation AND t.request_fingerprint=v_fingerprint
      AND t.state='FAILED' AND t.error_code='WORKER_OUTCOME_UNKNOWN')>=2 THEN
    RETURN QUERY SELECT NULL::UUID,NULL::UUID,NULL::UUID,TRUE; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('remote-owner:' || v_operation::TEXT || ':' || p_capability,0));
  SELECT a.node_id INTO v_node FROM public.remote_operation_assignments a
    JOIN public.execution_worker_nodes n ON n.id = a.node_id
    WHERE a.operation_id = v_operation AND a.capability = p_capability AND n.enabled AND NOT n.draining
      AND p_capability = ANY(n.capabilities) AND n.last_heartbeat_at > clock_timestamp() - INTERVAL '30 seconds'
      AND public.remote_worker_capability_capacity(n,p_capability)>0;
  IF v_node IS NULL AND p_capability = 'RANK' THEN v_node := public.rank_job_poll_owner((p_scope->>'jobId')::UUID); END IF;
  IF v_node IS NULL THEN
    SELECT n.id INTO v_node FROM public.execution_worker_nodes n WHERE n.enabled AND NOT n.draining
      AND p_capability = ANY(n.capabilities) AND n.last_heartbeat_at > clock_timestamp() - INTERVAL '30 seconds'
      AND public.remote_worker_capability_capacity(n,p_capability)>0
      AND CASE WHEN p_resource = 'CPU' THEN LEAST(n.max_cpu_slots,n.reported_cpu_slots) ELSE LEAST(n.max_http_slots,n.reported_http_slots) END > 0
    ORDER BY (SELECT COUNT(*)::FLOAT8 FROM public.remote_work_tasks t WHERE t.node_id=n.id AND t.state IN ('PENDING','CLAIMED')) /
      CASE WHEN p_resource='CPU' THEN LEAST(n.max_cpu_slots,n.reported_cpu_slots) ELSE LEAST(n.max_http_slots,n.reported_http_slots) END,
      n.active_work_items,n.id LIMIT 1;
  END IF;
  IF v_node IS NULL THEN RETURN; END IF;
  INSERT INTO public.remote_operation_assignments(operation_id,capability,workspace_id,project_id,job_id,node_id)
    VALUES(v_operation,p_capability,(p_scope->>'workspaceId')::UUID,(p_scope->>'projectId')::UUID,(p_scope->>'jobId')::UUID,v_node)
    ON CONFLICT(operation_id,capability) DO UPDATE SET node_id=EXCLUDED.node_id,assigned_at=clock_timestamp();
  INSERT INTO public.remote_work_tasks(workspace_id,project_id,operation_id,job_id,node_id,capability,command,resource,source_scope,payload,payload_hash,request_fingerprint,read_token_hash,lease_token,execution_deadline)
    VALUES((p_scope->>'workspaceId')::UUID,(p_scope->>'projectId')::UUID,v_operation,(p_scope->>'jobId')::UUID,v_node,
      p_capability,p_command,p_resource,p_scope,p_payload,p_hash,v_fingerprint,sha256(convert_to(v_token::TEXT,'UTF8')),v_token,
      clock_timestamp()+make_interval(secs=>p_timeout_ms::DOUBLE PRECISION/1000)) RETURNING remote_work_tasks.id INTO v_id;
  RETURN QUERY SELECT v_id,v_token,v_node,FALSE;
END $$;

CREATE FUNCTION public.remote_work_available(p_capability TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.execution_worker_nodes n WHERE n.enabled AND NOT n.draining
    AND p_capability=ANY(n.capabilities) AND n.last_heartbeat_at>clock_timestamp()-INTERVAL '30 seconds'
    AND public.remote_worker_capability_capacity(n,p_capability)>0)
$$;

CREATE FUNCTION public.enqueue_remote_work_batch(p_entries JSONB)
RETURNS TABLE("ordinal" INTEGER,"id" UUID,"readToken" UUID,"nodeId" UUID,"blocked" BOOLEAN,"errorCode" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE item RECORD; produced INTEGER;
BEGIN
  IF jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 64 OR octet_length(p_entries::TEXT)>16777216 THEN
    RAISE EXCEPTION 'Invalid work admission batch' USING ERRCODE='22023'; END IF;
  FOR item IN SELECT value,position FROM jsonb_array_elements(p_entries) WITH ORDINALITY AS entries(value,position)
    ORDER BY value->'scope'->>'operationId',value->>'capability',position
  LOOP
    BEGIN
      RETURN QUERY SELECT item.position::INTEGER,e.id,e."readToken",e."nodeId",e.blocked,NULL::TEXT
        FROM public.enqueue_remote_work(item.value->'scope',item.value->>'capability',item.value->>'command',item.value->>'resource',
          item.value->'payload',item.value->>'hash',(item.value->>'timeoutMs')::INTEGER) e;
      GET DIAGNOSTICS produced=ROW_COUNT;
      IF produced=0 THEN RETURN QUERY SELECT item.position::INTEGER,NULL::UUID,NULL::UUID,NULL::UUID,FALSE,NULL::TEXT; END IF;
    EXCEPTION WHEN serialization_failure THEN
      RETURN QUERY SELECT item.position::INTEGER,NULL::UUID,NULL::UUID,NULL::UUID,FALSE,'SOURCE_SCOPE_REVOKED'::TEXT;
    WHEN check_violation OR invalid_parameter_value OR invalid_text_representation THEN
      RETURN QUERY SELECT item.position::INTEGER,NULL::UUID,NULL::UUID,NULL::UUID,FALSE,'INVALID_WORKER_REQUEST'::TEXT;
    END;
  END LOOP;
END $$;

CREATE FUNCTION public.claim_remote_work(p_node UUID,p_http INTEGER,p_cpu INTEGER,p_capacities JSONB)
RETURNS SETOF public.remote_work_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE v_node public.execution_worker_nodes%ROWTYPE; v_task public.remote_work_tasks%ROWTYPE;
  v_http INTEGER; v_cpu INTEGER; v_limits JSONB; v_ids UUID[] := ARRAY[]::UUID[]; v_left INTEGER;
BEGIN
  IF p_http NOT BETWEEN 0 AND 512 OR p_cpu NOT BETWEEN 0 AND 128 OR jsonb_typeof(p_capacities)<>'object' THEN
    RAISE EXCEPTION 'Invalid available capacity' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('remote-node-slots:' || p_node::TEXT,0));
  SELECT * INTO v_node FROM public.execution_worker_nodes n WHERE n.id=p_node AND n.enabled AND NOT n.draining
    AND n.last_heartbeat_at > clock_timestamp()-INTERVAL '30 seconds';
  IF NOT FOUND THEN RETURN; END IF;
  SELECT LEAST(p_http,LEAST(v_node.max_http_slots,v_node.reported_http_slots) -
    (SELECT COUNT(*) FROM public.remote_work_tasks t WHERE t.node_id=p_node AND t.resource='HTTP' AND t.state='CLAIMED' AND t.execution_deadline>clock_timestamp()) -
    (SELECT COUNT(*) FROM public.rank_connector_executions e WHERE e.status='FETCHING' AND e.lease_owner LIKE 'remote:' || p_node::TEXT || ':%' AND e.lease_expires_at>clock_timestamp())) INTO v_http;
  SELECT LEAST(p_cpu,LEAST(v_node.max_cpu_slots,v_node.reported_cpu_slots) -
    (SELECT COUNT(*) FROM public.remote_work_tasks t WHERE t.node_id=p_node AND t.resource='CPU' AND t.state='CLAIMED' AND t.execution_deadline>clock_timestamp())) INTO v_cpu;
  v_limits := p_capacities;
  UPDATE public.remote_work_tasks SET state='ABANDONED',finished_at=clock_timestamp(),error_code='WORKER_ADMISSION_TIMEOUT'
    WHERE node_id=p_node AND state='PENDING' AND execution_deadline<=clock_timestamp();
  FOR v_task IN WITH eligible AS MATERIALIZED (
      SELECT t.id,row_number() OVER(PARTITION BY t.operation_id ORDER BY t.created_at,t.id) AS turn
      FROM public.remote_work_tasks t WHERE t.node_id=p_node AND t.state='PENDING' AND t.execution_deadline>clock_timestamp()
    ) SELECT t.* FROM public.remote_work_tasks t JOIN eligible e ON e.id=t.id
      ORDER BY e.turn,t.created_at,t.id FOR UPDATE OF t SKIP LOCKED LIMIT 256
  LOOP
    IF NOT v_task.capability = ANY(v_node.capabilities) OR NOT public.remote_work_scope_active(v_task.source_scope,v_task.capability) THEN
      UPDATE public.remote_work_tasks SET state='FAILED',finished_at=clock_timestamp(),error_code='SOURCE_SCOPE_REVOKED' WHERE remote_work_tasks.id=v_task.id;
      CONTINUE;
    END IF;
    v_left := LEAST(COALESCE((v_limits->>v_task.capability)::INTEGER,0),public.remote_worker_capability_capacity(v_node,v_task.capability) -
      (SELECT COUNT(*) FROM public.remote_work_tasks t WHERE t.node_id=p_node AND t.capability=v_task.capability AND t.state='CLAIMED' AND t.execution_deadline>clock_timestamp()) -
      CASE WHEN v_task.capability='RANK' THEN (SELECT COUNT(*) FROM public.rank_connector_executions e WHERE e.status='FETCHING' AND e.lease_owner LIKE 'remote:' || p_node::TEXT || ':%' AND e.lease_expires_at>clock_timestamp()) ELSE 0 END);
    IF v_left<1 OR (v_task.resource='HTTP' AND v_http<1) OR (v_task.resource='CPU' AND v_cpu<1) THEN CONTINUE; END IF;
    v_ids := array_append(v_ids,v_task.id);
    v_limits := jsonb_set(v_limits,ARRAY[v_task.capability],to_jsonb(v_left-1));
    IF v_task.resource='HTTP' THEN v_http:=v_http-1; ELSE v_cpu:=v_cpu-1; END IF;
  END LOOP;
  RETURN QUERY UPDATE public.remote_work_tasks SET state='CLAIMED',claimed_at=clock_timestamp()
    WHERE remote_work_tasks.id=ANY(v_ids) AND state='PENDING' RETURNING *;
END $$;

CREATE FUNCTION public.abandon_remote_work(p_id UUID,p_token UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
DECLARE v_state TEXT;
BEGIN
  UPDATE public.remote_work_tasks SET state='ABANDONED',finished_at=clock_timestamp()
    WHERE id=p_id AND read_token_hash=sha256(convert_to(p_token::TEXT,'UTF8')) AND state='PENDING';
  SELECT state INTO v_state FROM public.remote_work_tasks WHERE id=p_id AND read_token_hash=sha256(convert_to(p_token::TEXT,'UTF8'));
  RETURN v_state;
END $$;

CREATE FUNCTION public.read_remote_work_receipts(p_entries JSONB)
RETURNS SETOF public.remote_work_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,pg_temp AS $$
BEGIN
  IF jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries)>256 THEN
    RAISE EXCEPTION 'Invalid receipt batch' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT t.* FROM jsonb_to_recordset(p_entries) AS entry(id UUID,token UUID)
    JOIN public.remote_work_tasks t ON t.id=entry.id AND t.read_token_hash=sha256(convert_to(entry.token::TEXT,'UTF8'));
END $$;

CREATE FUNCTION public.remote_worker_http_capacity(p_node UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT (SELECT COUNT(*) FROM public.remote_work_tasks t WHERE t.node_id=n.id AND t.resource='HTTP' AND t.state='CLAIMED' AND t.execution_deadline>clock_timestamp()) +
    (SELECT COUNT(*) FROM public.rank_connector_executions e WHERE e.status='FETCHING' AND e.lease_owner LIKE 'remote:' || n.id::TEXT || ':%' AND e.lease_expires_at>clock_timestamp())
    < LEAST(n.max_http_slots,n.reported_http_slots)
    AND (SELECT COUNT(*) FROM public.remote_work_tasks t WHERE t.node_id=n.id AND t.capability='RANK' AND t.state='CLAIMED' AND t.execution_deadline>clock_timestamp()) +
      (SELECT COUNT(*) FROM public.rank_connector_executions e WHERE e.status='FETCHING' AND e.lease_owner LIKE 'remote:' || n.id::TEXT || ':%' AND e.lease_expires_at>clock_timestamp()) < public.remote_worker_capability_capacity(n,'RANK')
  FROM public.execution_worker_nodes n WHERE n.id=p_node
$$;

CREATE FUNCTION public.cancel_remote_work_for_node(p_node UUID)
RETURNS SETOF UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  UPDATE public.remote_work_tasks t SET state='FAILED',finished_at=clock_timestamp(),error_code='SOURCE_SCOPE_REVOKED'
    WHERE t.node_id=p_node AND t.state IN ('PENDING','CLAIMED') AND NOT public.remote_work_scope_active(t.source_scope,t.capability);
  RETURN QUERY SELECT t.id FROM public.remote_work_tasks t WHERE t.node_id=p_node AND t.state IN ('FAILED','ABANDONED')
    AND t.finished_at>clock_timestamp()-INTERVAL '15 minutes' ORDER BY t.finished_at DESC LIMIT 256;
END $$;

-- Rank and other HTTP capabilities reserve slots under the same node lock.
DO $migration$
DECLARE definition TEXT; start_at INTEGER; prefix TEXT;
BEGIN
  SELECT pg_get_functiondef('public.claim_rank_connector_poll_targeted(text,integer,text,uuid)'::regprocedure) INTO definition;
  start_at:=position(E'BEGIN\n' IN definition);
  IF start_at=0 THEN RAISE EXCEPTION 'Rank targeted claim changed'; END IF;
  prefix:=E'BEGIN\n  IF p_lease_owner ~ ''^remote:[0-9a-f-]{36}:[0-9a-f-]{36}$'' THEN\n'
    || E'    PERFORM pg_advisory_xact_lock(hashtextextended(''remote-node-slots:'' || split_part(p_lease_owner,'':'',2),0));\n'
    || E'    IF NOT COALESCE(public.remote_worker_http_capacity(split_part(p_lease_owner,'':'',2)::UUID),FALSE) THEN RETURN; END IF;\n'
    || E'  END IF;\n';
  EXECUTE overlay(definition placing prefix from start_at for length(E'BEGIN\n'));
END $migration$;

DO $migration$
DECLARE definition TEXT;
BEGIN
  SELECT pg_get_functiondef('public.rank_job_poll_owner(uuid)'::regprocedure) INTO definition;
  definition:=replace(definition,'LEAST(node.max_http_slots, node.reported_http_slots, node.reported_rank_slots)','public.remote_worker_capability_capacity(node,''RANK'')');
  EXECUTE definition;
  SELECT pg_get_functiondef('public.list_remote_worker_rank_assignments(integer)'::regprocedure) INTO definition;
  definition:=replace(definition,'WHERE execution.status IN (''SUBMITTING'', ''FETCHING'')',
    'WHERE execution.status IN (''SUBMITTING'', ''FETCHING'') AND NOT (execution.lease_owner NOT LIKE ''remote:%'' AND EXISTS (SELECT 1 FROM public.remote_work_tasks task WHERE task.command=''PROVIDER_HTTP'' AND task.capability=''RANK'' AND task.state IN (''PENDING'',''CLAIMED'') AND task.source_scope->>''executionId''=execution.id::TEXT))');
  definition:=replace(definition,'node.enabled AND NOT node.draining','node.enabled AND NOT node.draining AND public.remote_worker_capability_capacity(node,''RANK'')>0');
  EXECUTE definition;
END $migration$;

CREATE FUNCTION public.remote_work_immutable_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.id,OLD.workspace_id,OLD.project_id,OLD.operation_id,OLD.job_id,OLD.node_id,OLD.capability,OLD.command,OLD.resource,
      OLD.source_scope,OLD.payload,OLD.payload_hash,OLD.request_fingerprint,OLD.read_token_hash,OLD.lease_token,OLD.execution_deadline,OLD.created_at)
    IS DISTINCT FROM
     (NEW.id,NEW.workspace_id,NEW.project_id,NEW.operation_id,NEW.job_id,NEW.node_id,NEW.capability,NEW.command,NEW.resource,
      NEW.source_scope,NEW.payload,NEW.payload_hash,NEW.request_fingerprint,NEW.read_token_hash,NEW.lease_token,NEW.execution_deadline,NEW.created_at) THEN
    RAISE EXCEPTION 'Remote work identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state IN ('COMPLETED','FAILED','ABANDONED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Remote receipt is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state<>NEW.state AND NOT ((OLD.state='PENDING' AND NEW.state IN ('CLAIMED','FAILED','ABANDONED')) OR
    (OLD.state='CLAIMED' AND NEW.state IN ('COMPLETED','FAILED'))) THEN
    RAISE EXCEPTION 'Invalid remote work transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER remote_work_immutable BEFORE UPDATE ON public.remote_work_tasks FOR EACH ROW EXECUTE FUNCTION public.remote_work_immutable_guard();

-- The small assignment table contains current work only. Historical execution
-- evidence stays in task receipts, not in the scheduler's hot lookup.
CREATE FUNCTION public.remote_work_close_job_assignments() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  DELETE FROM public.remote_operation_assignments a USING remote_new_jobs n WHERE a.job_id=n.id
    AND n.status NOT IN ('RUNNING','QUEUED','RETRY_SCHEDULED','WAITING_RATE_LIMIT','FAILED_RETRYABLE','PREPARING');
  RETURN NULL;
END $$;
CREATE TRIGGER remote_work_close_jobs AFTER UPDATE ON public.jobs REFERENCING NEW TABLE AS remote_new_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION public.remote_work_close_job_assignments();
CREATE FUNCTION public.remote_work_close_import_assignments() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  DELETE FROM public.remote_operation_assignments a USING remote_new_imports n WHERE a.operation_id=n.id AND a.capability='IMPORT' AND n.status<>'PARSING';
  RETURN NULL;
END $$;
CREATE TRIGGER remote_work_close_imports AFTER UPDATE ON public.semantic_imports REFERENCING NEW TABLE AS remote_new_imports
  FOR EACH STATEMENT EXECUTE FUNCTION public.remote_work_close_import_assignments();
CREATE FUNCTION public.remote_work_close_upload_assignments() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  DELETE FROM public.remote_operation_assignments a USING remote_new_uploads n WHERE a.operation_id=n.id AND a.capability='INSPECTION' AND n.status<>'SCANNING';
  RETURN NULL;
END $$;
CREATE TRIGGER remote_work_close_uploads AFTER UPDATE ON public.uploads REFERENCING NEW TABLE AS remote_new_uploads
  FOR EACH STATEMENT EXECUTE FUNCTION public.remote_work_close_upload_assignments();

REVOKE ALL ON FUNCTION public.remote_work_scope_active(JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_remote_work_assignments(INTEGER,UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remote_work_available(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_remote_work(JSONB,TEXT,TEXT,TEXT,JSONB,TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_remote_work_batch(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_remote_work(UUID,INTEGER,INTEGER,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.abandon_remote_work(UUID,UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_remote_work_receipts(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remote_worker_http_capacity(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remote_worker_capability_capacity(public.execution_worker_nodes,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_remote_work_for_node(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remote_work_immutable_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remote_work_close_job_assignments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remote_work_close_import_assignments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remote_work_close_upload_assignments() FROM PUBLIC;
COMMIT;
