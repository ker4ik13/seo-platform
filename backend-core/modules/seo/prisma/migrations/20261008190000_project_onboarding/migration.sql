CREATE TABLE project_onboarding_initializations (
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  settings_hash BYTEA NOT NULL,
  response_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,project_id)
);
