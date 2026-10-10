-- Include standalone import operation IDs in the existing bounded assignment projection.
CREATE OR REPLACE FUNCTION public.list_remote_work_assignments(p_limit INTEGER,p_job_ids UUID[])
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
      AND (p_job_ids IS NULL OR COALESCE(a.job_id,a.operation_id)=ANY(p_job_ids)) AND (
        (j.status IN ('RUNNING','QUEUED','RETRY_SCHEDULED','WAITING_RATE_LIMIT') AND j.cancel_requested_at IS NULL) OR
        (a.capability='IMPORT' AND EXISTS(SELECT 1 FROM public.semantic_imports i WHERE i.id=a.operation_id AND i.status='PARSING')) OR
        (a.capability='INSPECTION' AND EXISTS(SELECT 1 FROM public.uploads u WHERE u.id=a.operation_id AND u.status='SCANNING')))
    GROUP BY a.node_id,a.job_id,a.operation_id,a.capability,j.scope_snapshot,j.provider LIMIT p_limit;
END $$;

CREATE INDEX semantic_imports_admin_history_idx ON public.semantic_imports(created_at DESC,id DESC);
