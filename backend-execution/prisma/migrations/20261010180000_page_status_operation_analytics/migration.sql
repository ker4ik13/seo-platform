CREATE OR REPLACE FUNCTION capture_job_analytics() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.type NOT IN ('FREQUENCY_COLLECTION','MANUAL_RANK_CHECK','AI_ANSWER_COLLECTION','CLUSTERING_RUN','TECHNICAL_CRAWL','KEYWORD_RESEARCH','SEMANTIC_EXPORT','PAGE_STATUS_CHANGE') THEN RETURN NEW; END IF;
  INSERT INTO public.operation_analytics_facts(id,workspace_id,project_id,actor_id,type,provider,origin,status,created_at,queued_at,started_at,first_result_at,finished_at,processed,provider_cost_micro,error_code)
  VALUES(NEW.id,NEW.workspace_id,NEW.project_id,NEW.actor_id,
    CASE WHEN NEW.type='FREQUENCY_COLLECTION' AND NEW.input_snapshot->>'mode'='SEASONALITY' THEN 'SEASONALITY_COLLECTION' ELSE NEW.type END,
    coalesce(NEW.provider,'LOCAL'),CASE WHEN NEW.schedule_id IS NOT NULL THEN 'AUTOMATION' WHEN NEW.actor_id IS NULL THEN 'SYSTEM' ELSE 'MANUAL' END,
    NEW.status::text,NEW.created_at,NEW.queued_at,NEW.started_at,CASE WHEN NEW.progress_current>0 AND (TG_OP='INSERT' OR OLD.progress_current=0) THEN clock_timestamp() ELSE NULL END,
    NEW.finished_at,NEW.progress_current,greatest(coalesce(NEW.actual_cost_micro,0),0),CASE WHEN NEW.error_summary->>'code' ~ '^[A-Z0-9_]{1,64}$' THEN NEW.error_summary->>'code' ELSE NULL END)
  ON CONFLICT(id) DO UPDATE SET status=excluded.status,queued_at=excluded.queued_at,started_at=excluded.started_at,
    first_result_at=coalesce(operation_analytics_facts.first_result_at,excluded.first_result_at),finished_at=excluded.finished_at,
    processed=excluded.processed,provider_cost_micro=excluded.provider_cost_micro,error_code=excluded.error_code,updated_at=clock_timestamp();
  RETURN NEW;
END $$;
