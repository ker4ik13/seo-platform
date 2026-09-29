BEGIN;

ALTER TABLE public.execution_worker_nodes
  ADD COLUMN reported_rank_slots INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT execution_worker_nodes_rank_slots
    CHECK (reported_rank_slots BETWEEN 0 AND 512);

COMMIT;
