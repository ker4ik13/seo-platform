CREATE INDEX IF NOT EXISTS "keywords_workspace_project_status_source_id_idx"
  ON "keywords" ("workspace_id", "project_id", "status", "source_mode", "id");
