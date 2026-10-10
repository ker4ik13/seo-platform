CREATE TABLE operation_analytics_facts (
  id UUID PRIMARY KEY, workspace_id UUID NOT NULL, project_id UUID, actor_id UUID,
  type VARCHAR(100) NOT NULL, provider VARCHAR(64) NOT NULL, origin VARCHAR(16) NOT NULL,
  status VARCHAR(32) NOT NULL, created_at TIMESTAMPTZ NOT NULL,
  queued_at TIMESTAMPTZ, started_at TIMESTAMPTZ, first_result_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
  processed BIGINT NOT NULL DEFAULT 0, provider_cost_micro BIGINT NOT NULL DEFAULT 0,
  error_code VARCHAR(64), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX operation_analytics_facts_created_idx ON operation_analytics_facts(created_at,type,provider);
CREATE INDEX operation_analytics_facts_workspace_idx ON operation_analytics_facts(workspace_id,created_at);

CREATE FUNCTION capture_job_analytics() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.type NOT IN ('FREQUENCY_COLLECTION','MANUAL_RANK_CHECK','AI_ANSWER_COLLECTION','CLUSTERING_RUN','TECHNICAL_CRAWL','KEYWORD_RESEARCH','SEMANTIC_EXPORT') THEN RETURN NEW; END IF;
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
CREATE TRIGGER job_analytics_insert AFTER INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION capture_job_analytics();
CREATE TRIGGER job_analytics_update AFTER UPDATE ON jobs FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR (OLD.progress_current=0 AND NEW.progress_current>0) OR OLD.actual_cost_micro IS DISTINCT FROM NEW.actual_cost_micro)
  EXECUTE FUNCTION capture_job_analytics();
REVOKE ALL ON FUNCTION capture_job_analytics() FROM PUBLIC;

CREATE FUNCTION capture_import_analytics() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  INSERT INTO public.operation_analytics_facts(id,workspace_id,project_id,actor_id,type,provider,origin,status,created_at,queued_at,started_at,first_result_at,finished_at,processed,error_code)
  VALUES(NEW.id,NEW.workspace_id,NEW.project_id,NEW.actor_id,'SEMANTIC_IMPORT','LOCAL','MANUAL',
    CASE WHEN NEW.status::text='FAILED' THEN 'FAILED_FINAL' ELSE NEW.status::text END,NEW.created_at,NEW.created_at,
    NEW.parsing_started_at,NEW.parsing_completed_at,CASE WHEN NEW.status::text IN ('COMPLETED','FAILED','CANCELLED') THEN NEW.updated_at ELSE NULL END,
    NEW.total_rows,CASE WHEN NEW.failure->>'code' ~ '^[A-Z0-9_]{1,64}$' THEN NEW.failure->>'code' ELSE NULL END)
  ON CONFLICT(id) DO UPDATE SET status=excluded.status,started_at=excluded.started_at,first_result_at=excluded.first_result_at,
    finished_at=excluded.finished_at,processed=excluded.processed,error_code=excluded.error_code,updated_at=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER import_analytics_insert AFTER INSERT ON semantic_imports FOR EACH ROW EXECUTE FUNCTION capture_import_analytics();
CREATE TRIGGER import_analytics_update AFTER UPDATE ON semantic_imports FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION capture_import_analytics();
REVOKE ALL ON FUNCTION capture_import_analytics() FROM PUBLIC;

-- No raw payloads or per-keyword rows are copied. Existing history is represented
-- by one compact row per operation; first-result time stays unknown on backfill.
INSERT INTO operation_analytics_facts(id,workspace_id,project_id,actor_id,type,provider,origin,status,created_at,queued_at,started_at,finished_at,processed,provider_cost_micro,error_code)
SELECT id,workspace_id,project_id,actor_id,CASE WHEN type='FREQUENCY_COLLECTION' AND input_snapshot->>'mode'='SEASONALITY' THEN 'SEASONALITY_COLLECTION' ELSE type END,
  coalesce(provider,'LOCAL'),CASE WHEN schedule_id IS NOT NULL THEN 'AUTOMATION' WHEN actor_id IS NULL THEN 'SYSTEM' ELSE 'MANUAL' END,
  status::text,created_at,queued_at,started_at,finished_at,progress_current,greatest(coalesce(actual_cost_micro,0),0),
  CASE WHEN error_summary->>'code' ~ '^[A-Z0-9_]{1,64}$' THEN error_summary->>'code' ELSE NULL END
FROM jobs WHERE created_at>=clock_timestamp()-interval '90 days' AND type IN ('FREQUENCY_COLLECTION','MANUAL_RANK_CHECK','AI_ANSWER_COLLECTION','CLUSTERING_RUN','TECHNICAL_CRAWL','KEYWORD_RESEARCH','SEMANTIC_EXPORT');
INSERT INTO operation_analytics_facts(id,workspace_id,project_id,actor_id,type,provider,origin,status,created_at,queued_at,started_at,first_result_at,finished_at,processed,error_code)
SELECT id,workspace_id,project_id,actor_id,'SEMANTIC_IMPORT','LOCAL','MANUAL',CASE WHEN status::text='FAILED' THEN 'FAILED_FINAL' ELSE status::text END,
  created_at,created_at,parsing_started_at,parsing_completed_at,CASE WHEN status::text IN ('COMPLETED','FAILED','CANCELLED') THEN updated_at ELSE NULL END,total_rows,
  CASE WHEN failure->>'code' ~ '^[A-Z0-9_]{1,64}$' THEN failure->>'code' ELSE NULL END
FROM semantic_imports WHERE created_at>=clock_timestamp()-interval '90 days';
