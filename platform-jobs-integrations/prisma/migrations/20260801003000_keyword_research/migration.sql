BEGIN;

CREATE TYPE "KeywordResearchStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'READY_TO_IMPORT',
  'IMPORT_QUEUED',
  'IMPORTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE UNIQUE INDEX
  "project_connector_routes_tenant_project_binding_id_key"
  ON "project_connector_routes"(
    "workspace_id",
    "project_id",
    "binding_id",
    "id"
  );

CREATE TABLE "keyword_research_runs" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "binding_id" UUID NOT NULL,
  "route_id" UUID NOT NULL,
  "credential_id" UUID NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "domain" VARCHAR(253) NOT NULL,
  "database" VARCHAR(16) NOT NULL,
  "max_keywords" INTEGER NOT NULL,
  "status" "KeywordResearchStatus" NOT NULL DEFAULT 'QUEUED',
  "next_page" INTEGER NOT NULL DEFAULT 1,
  "total_available" INTEGER,
  "collected_keywords" INTEGER NOT NULL DEFAULT 0,
  "selected_keywords" INTEGER NOT NULL DEFAULT 0,
  "imported_keywords" INTEGER NOT NULL DEFAULT 0,
  "duplicate_policy" VARCHAR(16),
  "entitlement" JSONB,
  "retry_at" TIMESTAMPTZ(6),
  "failure_code" VARCHAR(64),
  "lease_token" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "finished_at" TIMESTAMPTZ(6),

  CONSTRAINT "keyword_research_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "keyword_research_runs_job_id_key" UNIQUE ("job_id"),
  CONSTRAINT "keyword_research_runs_values_check" CHECK (
    "provider" = 'KEYS_SO'
    AND length("domain") BETWEEN 1 AND 253
    AND "domain" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    AND "database" IN (
      'msk','gru','zen','gkv','rnd','ekb','ufa','sar','krr','prm','sam',
      'kry','oms','kzn','che','nsk','nnv','vlg','vrn','spb','mns','tmn',
      'gmns','tom','gny'
    )
    AND "max_keywords" BETWEEN 25 AND 500
    AND "next_page" >= 1
    AND "collected_keywords" BETWEEN 0 AND "max_keywords"
    AND "selected_keywords" BETWEEN 0 AND "collected_keywords"
    AND "imported_keywords" BETWEEN 0 AND "selected_keywords"
    AND ("total_available" IS NULL OR "total_available" >= 0)
    AND ("duplicate_policy" IS NULL OR "duplicate_policy" IN (
      'SKIP_EXISTING', 'MERGE_NON_EMPTY', 'OVERWRITE_MAPPED'
    ))
    AND ("entitlement" IS NULL OR jsonb_typeof("entitlement") = 'object')
    AND ("failure_code" IS NULL OR "failure_code" ~ '^[A-Z][A-Z0-9_]{0,63}$')
    AND "version" >= 1
    AND (
      ("status" IN ('QUEUED','RUNNING','RETRY_SCHEDULED','READY_TO_IMPORT')
        AND "duplicate_policy" IS NULL AND "entitlement" IS NULL)
      OR
      ("status" IN ('IMPORT_QUEUED','IMPORTING','COMPLETED','FAILED')
        AND (
          ("duplicate_policy" IS NOT NULL AND "entitlement" IS NOT NULL)
          OR ("status" = 'FAILED')
        ))
      OR "status" = 'CANCELLED'
    )
  ),
  CONSTRAINT "keyword_research_runs_job_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES "jobs"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "keyword_research_runs_binding_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "binding_id")
    REFERENCES "project_connector_bindings"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "keyword_research_runs_route_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "binding_id", "route_id")
    REFERENCES "project_connector_routes"(
      "workspace_id", "project_id", "binding_id", "id"
    )
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "keyword_research_runs_credential_tenant_fkey"
    FOREIGN KEY ("workspace_id", "credential_id")
    REFERENCES "integration_credentials"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "keyword_research_runs_tenant_project_id_key"
  ON "keyword_research_runs"("workspace_id", "project_id", "id");
CREATE UNIQUE INDEX "keyword_research_runs_tenant_project_job_key"
  ON "keyword_research_runs"("workspace_id", "project_id", "job_id");
CREATE INDEX "keyword_research_runs_tenant_created_idx"
  ON "keyword_research_runs"(
    "workspace_id", "project_id", "created_at" DESC
  );
CREATE INDEX "keyword_research_runs_dispatch_idx"
  ON "keyword_research_runs"("status", "retry_at", "created_at");

CREATE TABLE "keyword_research_pages" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "page" INTEGER NOT NULL,
  "response_hash" BYTEA NOT NULL,
  "row_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "keyword_research_pages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "keyword_research_pages_values_check" CHECK (
    "page" >= 1
    AND "row_count" BETWEEN 0 AND 25
    AND octet_length("response_hash") = 32
  ),
  CONSTRAINT "keyword_research_pages_run_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "run_id")
    REFERENCES "keyword_research_runs"("workspace_id", "project_id", "id")
    ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "keyword_research_pages_run_page_key"
  ON "keyword_research_pages"("run_id", "page");
CREATE INDEX "keyword_research_pages_tenant_run_page_idx"
  ON "keyword_research_pages"(
    "workspace_id", "project_id", "run_id", "page"
  );

CREATE TABLE "keyword_research_rows" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "provider_row_id" VARCHAR(128),
  "keyword" TEXT NOT NULL,
  "url" TEXT,
  "frequency_base" INTEGER,
  "frequency_exact" INTEGER,
  "frequency_fixed" INTEGER,
  "position" INTEGER,
  "kei" DOUBLE PRECISION,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "keyword_research_rows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "keyword_research_rows_values_check" CHECK (
    "ordinal" >= 1
    AND length(btrim("keyword")) BETWEEN 1 AND 2000
    AND ("url" IS NULL OR length("url") BETWEEN 1 AND 8192)
    AND ("frequency_base" IS NULL OR "frequency_base" >= 0)
    AND ("frequency_exact" IS NULL OR "frequency_exact" >= 0)
    AND ("frequency_fixed" IS NULL OR "frequency_fixed" >= 0)
    AND ("position" IS NULL OR "position" >= 1)
    AND (
      "kei" IS NULL
      OR (
        "kei" >= 0
        AND "kei" <> 'NaN'::DOUBLE PRECISION
        AND "kei" <> 'Infinity'::DOUBLE PRECISION
      )
    )
  ),
  CONSTRAINT "keyword_research_rows_run_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "run_id")
    REFERENCES "keyword_research_runs"("workspace_id", "project_id", "id")
    ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "keyword_research_rows_run_ordinal_key"
  ON "keyword_research_rows"("run_id", "ordinal");
CREATE INDEX "keyword_research_rows_tenant_selected_idx"
  ON "keyword_research_rows"(
    "workspace_id", "project_id", "run_id", "selected", "ordinal"
  );

CREATE FUNCTION public.claim_keyword_research_run(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER
)
RETURNS TABLE (
  "runId" UUID,
  "workspaceId" UUID,
  "projectId" UUID,
  "jobId" UUID,
  "credentialId" UUID,
  "domain" TEXT,
  "database" TEXT,
  "page" INTEGER,
  "maxKeywords" INTEGER,
  "collectedKeywords" INTEGER,
  "runVersion" INTEGER,
  "jobVersion" INTEGER,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ,
  "ciphertext" BYTEA,
  "nonce" BYTEA,
  "authTag" BYTEA,
  "encryptedDataKey" BYTEA,
  "dataKeyNonce" BYTEA,
  "dataKeyAuthTag" BYTEA,
  "keyVersion" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  candidate public.keyword_research_runs%ROWTYPE;
  job_row public.jobs%ROWTYPE;
  credential_row public.integration_credentials%ROWTYPE;
  token UUID := uuidv7();
  expires_at TIMESTAMPTZ;
BEGIN
  IF p_lease_owner !~ '^[A-Za-z0-9._:-]{8,100}$'
     OR p_lease_seconds NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'invalid keyword research claim';
  END IF;
  expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);

  SELECT run.*
  INTO candidate
  FROM public.keyword_research_runs run
  JOIN public.jobs job ON job.id = run.job_id
  WHERE run.status IN ('QUEUED', 'RETRY_SCHEDULED')
    AND (run.retry_at IS NULL OR run.retry_at <= clock_timestamp())
    AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= clock_timestamp())
  ORDER BY run.created_at, run.id
  FOR UPDATE OF run SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = candidate.job_id
  FOR UPDATE;

  SELECT credential.* INTO credential_row
  FROM public.integration_credentials credential
  JOIN public.project_connector_bindings binding
    ON binding.id = candidate.binding_id
   AND binding.workspace_id = candidate.workspace_id
   AND binding.project_id = candidate.project_id
  JOIN public.project_connector_routes route
    ON route.id = candidate.route_id
   AND route.binding_id = binding.id
   AND route.credential_id = credential.id
  WHERE credential.id = candidate.credential_id
    AND credential.workspace_id = candidate.workspace_id
    AND credential.provider = 'KEYS_SO'
    AND credential.mode = 'BYOK_API_KEY'
    AND credential.status = 'ACTIVE'
    AND credential.deleted_at IS NULL
    AND binding.enabled
    AND binding.capability = 'COMPETITOR_RESEARCH'
    AND credential.capabilities ? 'COMPETITOR_RESEARCH';

  IF NOT FOUND THEN
    UPDATE public.keyword_research_runs
    SET status = 'FAILED',
        failure_code = 'CONNECTOR_NOT_READY',
        finished_at = clock_timestamp(),
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = candidate.id;
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED',
        error_summary = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        finished_at = clock_timestamp(),
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = candidate.job_id;
    RETURN;
  END IF;

  UPDATE public.keyword_research_runs
  SET status = 'RUNNING',
      retry_at = NULL,
      failure_code = NULL,
      lease_token = token,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = candidate.id
  RETURNING * INTO candidate;

  UPDATE public.jobs
  SET status = 'RUNNING',
      stage = 'collecting',
      started_at = COALESCE(started_at, clock_timestamp()),
      retry_at = NULL,
      lease_owner = p_lease_owner,
      lease_expires_at = expires_at,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = candidate.job_id
  RETURNING * INTO job_row;

  RETURN QUERY SELECT
    candidate.id,
    candidate.workspace_id,
    candidate.project_id,
    candidate.job_id,
    candidate.credential_id,
    candidate.domain::TEXT,
    candidate.database::TEXT,
    candidate.next_page,
    candidate.max_keywords,
    candidate.collected_keywords,
    candidate.version,
    job_row.version,
    token,
    expires_at,
    credential_row.ciphertext,
    credential_row.nonce,
    credential_row.auth_tag,
    credential_row.encrypted_data_key,
    credential_row.data_key_nonce,
    credential_row.data_key_auth_tag,
    credential_row.key_version;
END
$$;

CREATE FUNCTION public.complete_keyword_research_page(
  p_run_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_run_version INTEGER,
  p_job_version INTEGER,
  p_rows JSONB,
  p_response_hash BYTEA,
  p_total_available INTEGER,
  p_complete BOOLEAN
)
RETURNS TABLE ("runId" UUID, "runVersion" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  run_row public.keyword_research_runs%ROWTYPE;
  job_row public.jobs%ROWTYPE;
  row_count INTEGER;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) > 25
     OR octet_length(p_response_hash) <> 32
     OR (p_total_available IS NOT NULL AND p_total_available < 0) THEN
    RAISE EXCEPTION 'invalid keyword research page';
  END IF;
  row_count := jsonb_array_length(p_rows);

  SELECT run.* INTO run_row
  FROM public.keyword_research_runs run
  WHERE run.id = p_run_id
    AND run.status = 'RUNNING'
    AND run.version = p_run_version
    AND run.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = run_row.job_id
    AND job.status = 'RUNNING'
    AND job.version = p_job_version
    AND job.lease_owner = p_lease_owner
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item
    WHERE jsonb_typeof(item) <> 'object'
      OR jsonb_typeof(item->'keyword') <> 'string'
      OR length(btrim(item->>'keyword')) NOT BETWEEN 1 AND 2000
      OR (item ? 'url' AND (
        jsonb_typeof(item->'url') <> 'string'
        OR length(item->>'url') NOT BETWEEN 1 AND 8192
      ))
  ) THEN
    RAISE EXCEPTION 'invalid keyword research result row';
  END IF;

  INSERT INTO public.keyword_research_pages(
    workspace_id, project_id, run_id, page, response_hash, row_count
  ) VALUES (
    run_row.workspace_id, run_row.project_id, run_row.id, run_row.next_page,
    p_response_hash, row_count
  );

  INSERT INTO public.keyword_research_rows(
    workspace_id, project_id, run_id, ordinal, provider_row_id, keyword, url,
    frequency_base, frequency_exact, frequency_fixed, position, kei
  )
  SELECT
    run_row.workspace_id,
    run_row.project_id,
    run_row.id,
    run_row.collected_keywords + item.ordinality::INTEGER,
    value."providerRowId",
    btrim(value.keyword),
    value.url,
    value."frequencyBase",
    value."frequencyExact",
    value."frequencyFixed",
    value.position,
    value.kei
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY item(json, ordinality)
  CROSS JOIN LATERAL jsonb_to_record(item.json) AS value(
    "providerRowId" TEXT,
    keyword TEXT,
    url TEXT,
    "frequencyBase" INTEGER,
    "frequencyExact" INTEGER,
    "frequencyFixed" INTEGER,
    position INTEGER,
    kei DOUBLE PRECISION
  );

  UPDATE public.keyword_research_runs
  SET status = CASE
        WHEN p_complete THEN 'READY_TO_IMPORT'::public."KeywordResearchStatus"
        ELSE 'QUEUED'::public."KeywordResearchStatus"
      END,
      next_page = next_page + 1,
      total_available = COALESCE(p_total_available, total_available),
      collected_keywords = collected_keywords + row_count,
      lease_token = NULL,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = run_row.id
  RETURNING * INTO run_row;

  UPDATE public.jobs
  SET status = CASE
        WHEN p_complete THEN 'AWAITING_APPROVAL'::public."JobStatus"
        ELSE 'QUEUED'::public."JobStatus"
      END,
      stage = CASE WHEN p_complete THEN 'preview' ELSE 'collecting' END,
      progress_current = run_row.collected_keywords,
      lease_owner = NULL,
      lease_expires_at = NULL,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = run_row.job_id;

  RETURN QUERY SELECT run_row.id, run_row.version;
END
$$;

CREATE FUNCTION public.fail_keyword_research_run(
  p_run_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_run_version INTEGER,
  p_job_version INTEGER,
  p_error_code TEXT,
  p_retry_after_seconds INTEGER
)
RETURNS TABLE ("runId" UUID, "runVersion" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  run_row public.keyword_research_runs%ROWTYPE;
  job_row public.jobs%ROWTYPE;
  should_retry BOOLEAN;
BEGIN
  IF p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
     OR (p_retry_after_seconds IS NOT NULL
       AND p_retry_after_seconds NOT BETWEEN 5 AND 3600) THEN
    RAISE EXCEPTION 'invalid keyword research failure';
  END IF;
  SELECT run.* INTO run_row
  FROM public.keyword_research_runs run
  WHERE run.id = p_run_id
    AND run.status = 'RUNNING'
    AND run.version = p_run_version
    AND run.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = run_row.job_id
    AND job.status = 'RUNNING'
    AND job.version = p_job_version
    AND job.lease_owner = p_lease_owner
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  should_retry :=
    p_retry_after_seconds IS NOT NULL
    AND job_row.attempt + 1 < job_row.max_attempts;

  UPDATE public.keyword_research_runs
  SET status = CASE
        WHEN should_retry THEN 'RETRY_SCHEDULED'::public."KeywordResearchStatus"
        ELSE 'FAILED'::public."KeywordResearchStatus"
      END,
      retry_at = CASE
        WHEN should_retry
        THEN clock_timestamp() + make_interval(secs => p_retry_after_seconds)
        ELSE NULL
      END,
      failure_code = p_error_code,
      lease_token = NULL,
      finished_at = CASE WHEN should_retry THEN NULL ELSE clock_timestamp() END,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = run_row.id
  RETURNING * INTO run_row;

  UPDATE public.jobs
  SET status = CASE
        WHEN should_retry THEN 'RETRY_SCHEDULED'::public."JobStatus"
        ELSE 'FAILED_FINAL'::public."JobStatus"
      END,
      attempt = attempt + 1,
      retry_at = CASE
        WHEN should_retry
        THEN clock_timestamp() + make_interval(secs => p_retry_after_seconds)
        ELSE NULL
      END,
      error_summary = jsonb_build_object('code', p_error_code),
      lease_owner = NULL,
      lease_expires_at = NULL,
      finished_at = CASE WHEN should_retry THEN NULL ELSE clock_timestamp() END,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = run_row.job_id;

  RETURN QUERY SELECT run_row.id, run_row.version;
END
$$;

REVOKE ALL ON FUNCTION
  public.claim_keyword_research_run(TEXT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.complete_keyword_research_page(
    UUID, TEXT, UUID, INTEGER, INTEGER, JSONB, BYTEA, INTEGER, BOOLEAN
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.fail_keyword_research_run(
    UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER
  )
  FROM PUBLIC;

COMMIT;
