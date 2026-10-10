ALTER TABLE projects ADD COLUMN onboarding JSONB;
ALTER TABLE projects ADD CONSTRAINT projects_onboarding_object_check
  CHECK(onboarding IS NULL OR (jsonb_typeof(onboarding)='object' AND onboarding->>'version'='1'));
CREATE TABLE project_creation_receipts (
  workspace_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(180) NOT NULL,
  request_hash BYTEA NOT NULL,
  project_id UUID NOT NULL UNIQUE,
  provisioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,actor_id,idempotency_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
