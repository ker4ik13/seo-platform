BEGIN;

-- A durable submit marker normally means a paid request may have started.
-- Only a fenced Gateway receipt that proves no send may release that marker.
CREATE FUNCTION public.remote_submit_did_not_start(p_job UUID,p_owner TEXT,p_capability TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j JOIN public.remote_work_tasks t ON t.job_id=j.id
    WHERE j.id=p_job AND j.status='RUNNING' AND j.lease_owner=p_owner
      AND j.lease_expires_at>clock_timestamp() AND j.provider='ARSENKIN'
      AND t.workspace_id=j.workspace_id AND t.project_id IS NOT DISTINCT FROM j.project_id
      AND t.capability=p_capability AND t.command='PROVIDER_HTTP'
      AND t.payload->>'url'='https://arsenkin.ru/api/tools/set'
      AND t.source_scope->>'origin'='JOB' AND t.source_scope->>'leaseOwner'=p_owner
      AND t.source_scope->>'credentialId'=j.scope_snapshot->>'credentialId'
      AND t.created_at>=j.updated_at
      AND (t.state='ABANDONED' OR (t.state='FAILED' AND t.error_code IN ('WORKER_NOT_STARTED','WORKER_MATERIAL_UNAVAILABLE')))
  )
$$;
REVOKE ALL ON FUNCTION public.remote_submit_did_not_start(UUID,TEXT,TEXT) FROM PUBLIC;

DO $migration$
DECLARE signature REGPROCEDURE; definition TEXT; needle TEXT; capability TEXT; section TEXT; start_at INTEGER; end_at INTEGER;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.defer_frequency_collection_batch_capacity(uuid,uuid[],text,integer,integer)'::regprocedure,
    'public._transition_ai_answer_collection_batch(uuid,uuid[],text,integer,text,text,integer,text)'::regprocedure,
    'public.transition_clustering_run(uuid,uuid[],text,integer,text,text,integer,text,jsonb)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(signature) INTO definition;
    IF signature='public.defer_frequency_collection_batch_capacity(uuid,uuid[],text,integer,integer)'::regprocedure THEN
      capability:='WORDSTAT'; needle:='item.provider_request_id IS NULL';
    ELSIF signature='public._transition_ai_answer_collection_batch(uuid,uuid[],text,integer,text,text,integer,text)'::regprocedure THEN
      capability:='AI_ANSWER'; needle:='WHEN ''CAPACITY'' THEN item.provider_request_id IS NULL';
    ELSE
      capability:='CLUSTERING'; needle:='WHEN ''CAPACITY'' THEN item.provider_request_id IS NULL';
    END IF;
    IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
      RAISE EXCEPTION 'Unexpected capacity marker guard: %',signature;
    END IF;
    definition:=replace(definition,needle,replace(needle,'item.provider_request_id IS NULL',
      '(item.provider_request_id IS NULL OR (item.provider_request_id LIKE ''submitting:%'' AND public.remote_submit_did_not_start(p_job_id,p_lease_owner,''' || capability || ''')))'));
    IF capability='WORDSTAT' THEN
      section:=definition;
      start_at:=1; end_at:=length(definition)+1;
    ELSE
      start_at:=position('ELSIF p_action = ''CAPACITY'' THEN' IN definition);
      end_at:=position('ELSIF p_action = ''QUARANTINE'' THEN' IN definition);
      IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'Unexpected capacity transition: %',signature; END IF;
      section:=substring(definition FROM start_at FOR end_at-start_at);
    END IF;
    needle:='attempt = attempt - 1,';
    IF (length(section)-length(replace(section,needle,'')))/length(needle)<>1 THEN
      RAISE EXCEPTION 'Unexpected capacity attempt counter: %',signature;
    END IF;
    section:=replace(section,needle,'provider_request_id = NULL, ' || needle);
    EXECUTE overlay(definition placing section FROM start_at FOR end_at-start_at);
  END LOOP;
END $migration$;
COMMIT;
