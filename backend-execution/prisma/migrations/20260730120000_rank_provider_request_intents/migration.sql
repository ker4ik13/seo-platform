BEGIN;

-- This contract adds required evidence to every connector execution. Existing
-- pre-release rows cannot be reconstructed safely from mutable provider state,
-- so deployment must stop and use an explicit expand/backfill/validate plan.
LOCK TABLE public.rank_connector_executions IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.rank_connector_executions
  ) THEN
    RAISE EXCEPTION
      'rank provider request intent migration requires empty pre-release rank_connector_executions; use an explicit expand/backfill/validate/contract migration';
  END IF;
END
$$;

CREATE TABLE public.rank_provider_request_intents (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "job_item_id" UUID NOT NULL,
  "manifest_id" UUID NOT NULL,
  "manifest_hash" BYTEA NOT NULL,
  "manifest_chunk_index" INTEGER NOT NULL,
  "manifest_chunk_hash" BYTEA NOT NULL,
  "schema_version" VARCHAR(64) NOT NULL,
  "request_snapshot" JSONB NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_provider_request_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rank_provider_request_intents_shape"
    CHECK (
      octet_length("manifest_hash") = 32
      AND "manifest_chunk_index" BETWEEN 0 AND 3
      AND octet_length("manifest_chunk_hash") = 32
      AND "schema_version" = 'rank-provider-request-intent@1'
      AND jsonb_typeof("request_snapshot") = 'object'
      AND octet_length("request_snapshot"::text) <= 1048576
      AND octet_length("request_hash") = 32
    )
);

CREATE UNIQUE INDEX
  "rank_provider_request_intents_tenant_job_item_key"
  ON public.rank_provider_request_intents (
    "workspace_id",
    "project_id",
    "job_id",
    "job_item_id"
  );

-- The execution FK includes both request and manifest evidence. A caller
-- cannot pair an intent ID with hashes or a manifest chunk from another row.
CREATE UNIQUE INDEX "rank_provider_request_intents_execution_key"
  ON public.rank_provider_request_intents (
    "workspace_id",
    "project_id",
    "job_id",
    "job_item_id",
    "id",
    "request_hash",
    "manifest_id",
    "manifest_hash",
    "manifest_chunk_index",
    "manifest_chunk_hash"
  );

CREATE INDEX "rank_provider_request_intents_job_created_idx"
  ON public.rank_provider_request_intents (
    "workspace_id",
    "project_id",
    "job_id",
    "created_at"
  );

ALTER TABLE public.rank_provider_request_intents
  ADD CONSTRAINT "rank_provider_request_intents_job_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES public.jobs ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_provider_request_intents_rank_run_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES public.rank_job_runs (
      "workspace_id",
      "project_id",
      "job_id"
    )
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_provider_request_intents_job_item_tenant_fkey"
    FOREIGN KEY (
      "workspace_id",
      "project_id",
      "job_id",
      "job_item_id"
    )
    REFERENCES public.job_items (
      "workspace_id",
      "project_id",
      "job_id",
      "id"
    )
    ON DELETE RESTRICT
    ON UPDATE RESTRICT;

CREATE FUNCTION public.reject_rank_provider_request_intent_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Rank provider request intents are append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_provider_request_intent_no_mutation"
  BEFORE UPDATE OR DELETE ON public.rank_provider_request_intents
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_rank_provider_request_intent_mutation();

CREATE FUNCTION public.reject_rank_provider_request_intent_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Rank provider request intents cannot be truncated'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_provider_request_intent_no_truncate"
  BEFORE TRUNCATE ON public.rank_provider_request_intents
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.reject_rank_provider_request_intent_truncate();

ALTER TABLE public.rank_connector_executions
  ADD COLUMN "provider_request_intent_id" UUID NOT NULL,
  ADD COLUMN "provider_request_intent_hash" BYTEA NOT NULL,
  ADD COLUMN "provider_request_intent_chunk_hash" BYTEA NOT NULL,
  ADD CONSTRAINT "rank_connector_executions_provider_intent_hashes"
    CHECK (
      octet_length("provider_request_intent_hash") = 32
      AND octet_length("provider_request_intent_chunk_hash") = 32
    ),
  ADD CONSTRAINT
    "rank_connector_executions_provider_request_intent_fkey"
    FOREIGN KEY (
      "workspace_id",
      "project_id",
      "job_id",
      "job_item_id",
      "provider_request_intent_id",
      "provider_request_intent_hash",
      "manifest_id",
      "manifest_hash",
      "manifest_chunk_index",
      "provider_request_intent_chunk_hash"
    )
    REFERENCES public.rank_provider_request_intents (
      "workspace_id",
      "project_id",
      "job_id",
      "job_item_id",
      "id",
      "request_hash",
      "manifest_id",
      "manifest_hash",
      "manifest_chunk_index",
      "manifest_chunk_hash"
    )
    ON DELETE RESTRICT
    ON UPDATE RESTRICT;

-- Existing claim/authorize guards protect the original immutable identity.
-- Keep the newly added evidence immutable independently so later lifecycle
-- updates cannot switch the provider request after grant consumption.
CREATE FUNCTION
  public.assert_rank_connector_execution_provider_intent_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF ROW(
    NEW."provider_request_intent_id",
    NEW."provider_request_intent_hash",
    NEW."provider_request_intent_chunk_hash"
  ) IS DISTINCT FROM ROW(
    OLD."provider_request_intent_id",
    OLD."provider_request_intent_hash",
    OLD."provider_request_intent_chunk_hash"
  ) THEN
    RAISE EXCEPTION 'Rank connector provider request intent is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "rank_connector_execution_provider_intent_guard"
  BEFORE UPDATE ON public.rank_connector_executions
  FOR EACH ROW
  EXECUTE FUNCTION
    public.assert_rank_connector_execution_provider_intent_immutable();

COMMENT ON COLUMN
  public.rank_provider_request_intents."request_snapshot"
IS
  'Privacy-sensitive exact provider request; never expose through public DTO, queue, log, trace, or event.';

COMMENT ON COLUMN
  public.rank_provider_request_intents."request_hash"
IS
  'SHA-256 of the exact versioned provider request snapshot.';

REVOKE ALL ON TABLE public.rank_provider_request_intents FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.reject_rank_provider_request_intent_mutation()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.reject_rank_provider_request_intent_truncate()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.assert_rank_connector_execution_provider_intent_immutable()
  FROM PUBLIC;

-- Earlier service-runtime deployments grant jobs_runtime default DML on new
-- tables. Close that privilege inside the same transaction that creates the
-- privacy-sensitive snapshot, before any application process can observe it.
-- Disposable migration databases may not provision production login roles,
-- hence the guarded role lookup. The post-migration permission reconciler
-- repeats this exact boundary and provisions late-created roles.
DO $acl$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'jobs_runtime'
  ) THEN
    EXECUTE
      'REVOKE ALL PRIVILEGES ON TABLE public.rank_provider_request_intents FROM jobs_runtime';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'jobs_rank_runtime'
  ) THEN
    EXECUTE
      'REVOKE ALL PRIVILEGES ON TABLE public.rank_provider_request_intents FROM jobs_rank_runtime';
    EXECUTE
      'GRANT SELECT, INSERT ON TABLE public.rank_provider_request_intents TO jobs_rank_runtime';
  END IF;
END
$acl$;

COMMIT;
