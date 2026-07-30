CREATE INDEX "keywords_workspace_project_status_updated_id_idx"
ON "keywords"(
  "workspace_id",
  "project_id",
  "status",
  "updated_at" DESC,
  "id" DESC
);

CREATE INDEX "keywords_workspace_project_status_text_id_idx"
ON "keywords"(
  "workspace_id",
  "project_id",
  "status",
  "text_normalized",
  "id"
);

CREATE INDEX "keywords_workspace_project_status_priority_id_idx"
ON "keywords"(
  "workspace_id",
  "project_id",
  "status",
  "priority" DESC,
  "id" DESC
);

CREATE INDEX "keywords_workspace_project_status_intent_created_idx"
ON "keywords"(
  "workspace_id",
  "project_id",
  "status",
  "intent",
  "created_at" DESC,
  "id" DESC
);
