ALTER TABLE public.execution_worker_nodes ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE public.execution_worker_nodes ADD CONSTRAINT worker_node_deleted_stays_disabled
  CHECK (deleted_at IS NULL OR (NOT enabled AND draining));
CREATE INDEX execution_worker_nodes_visible_created_idx ON public.execution_worker_nodes(created_at DESC,id DESC)
  WHERE deleted_at IS NULL;
