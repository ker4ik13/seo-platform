ALTER TABLE public.execution_worker_nodes
  ADD COLUMN reported_build_hash CHAR(64);

ALTER TABLE public.execution_worker_nodes
  ADD CONSTRAINT execution_worker_nodes_reported_build_hash_check
  CHECK (reported_build_hash IS NULL OR reported_build_hash ~ '^[a-f0-9]{64}$');
