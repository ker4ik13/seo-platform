BEGIN;

CREATE TABLE public.execution_worker_nodes (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  name VARCHAR(100) NOT NULL,
  token_hash BYTEA NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  draining BOOLEAN NOT NULL DEFAULT false,
  capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  max_http_slots INTEGER NOT NULL DEFAULT 16,
  max_cpu_slots INTEGER NOT NULL DEFAULT 2,
  reported_http_slots INTEGER NOT NULL DEFAULT 0,
  reported_cpu_slots INTEGER NOT NULL DEFAULT 0,
  reported_memory_bytes BIGINT NOT NULL DEFAULT 0,
  active_work_items INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ,
  last_protocol_version INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT execution_worker_nodes_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT execution_worker_nodes_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT execution_worker_nodes_http_slots CHECK (max_http_slots BETWEEN 1 AND 512 AND reported_http_slots BETWEEN 0 AND 512),
  CONSTRAINT execution_worker_nodes_cpu_slots CHECK (max_cpu_slots BETWEEN 1 AND 128 AND reported_cpu_slots BETWEEN 0 AND 128),
  CONSTRAINT execution_worker_nodes_runtime_bounds CHECK (reported_memory_bytes >= 0 AND active_work_items BETWEEN 0 AND 4096),
  CONSTRAINT execution_worker_nodes_protocol CHECK (last_protocol_version IS NULL OR last_protocol_version BETWEEN 1 AND 100),
  CONSTRAINT execution_worker_nodes_capabilities CHECK (
    capabilities <@ ARRAY[
      'RANK', 'WORDSTAT', 'RESEARCH', 'AI_ANSWER', 'CLUSTERING',
      'CRAWL', 'IMPORT', 'EXPORT', 'INSPECTION'
    ]::TEXT[]
  )
);

CREATE INDEX execution_worker_nodes_availability_idx
  ON public.execution_worker_nodes (enabled, draining, last_heartbeat_at DESC);

COMMIT;
