CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX "keywords_workspace_project_status_created_id_idx"
  ON "keywords"(
    "workspace_id",
    "project_id",
    "status",
    "created_at" DESC,
    "id" DESC
  );

CREATE INDEX "keywords_text_normalized_trgm_idx"
  ON "keywords"
  USING GIN ("text_normalized" gin_trgm_ops);
