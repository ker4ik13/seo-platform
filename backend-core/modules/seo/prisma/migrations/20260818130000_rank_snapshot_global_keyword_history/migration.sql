CREATE INDEX CONCURRENTLY "rank_snapshots_keyword_global_history_idx"
  ON "rank_snapshots" (
    "workspace_id",
    "project_id",
    "keyword_id",
    "observed_at" DESC,
    "id" DESC
  );
