CREATE INDEX remote_work_tasks_terminal_finished_idx
  ON public.remote_work_tasks(finished_at,id)
  WHERE state IN ('COMPLETED','FAILED','ABANDONED');
