CREATE TABLE "api_tokens" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "prefix" VARCHAR(24) NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "previous_token_hash" CHAR(64),
  "previous_token_valid_until" TIMESTAMPTZ(6),
  "scopes" JSONB NOT NULL,
  "all_projects" BOOLEAN NOT NULL DEFAULT FALSE,
  "expires_at" TIMESTAMPTZ(6),
  "last_used_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_tokens_scopes_array_check"
    CHECK (jsonb_typeof("scopes") = 'array'),
  CONSTRAINT "api_tokens_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "api_tokens_tenant_id_key" UNIQUE ("id", "workspace_id"),
  CONSTRAINT "api_tokens_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "api_tokens_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "api_tokens_workspace_id_created_by_created_at_idx"
  ON "api_tokens"("workspace_id", "created_by", "created_at");
CREATE INDEX "api_tokens_workspace_id_revoked_at_expires_at_idx"
  ON "api_tokens"("workspace_id", "revoked_at", "expires_at");
CREATE INDEX "api_tokens_previous_token_hash_previous_token_valid_until_idx"
  ON "api_tokens"("previous_token_hash", "previous_token_valid_until");

CREATE UNIQUE INDEX "projects_tenant_id_key"
  ON "projects"("id", "workspace_id");

CREATE TABLE "api_token_project_accesses" (
  "api_token_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "api_token_project_accesses_pkey"
    PRIMARY KEY ("api_token_id", "project_id"),
  CONSTRAINT "api_token_project_accesses_api_token_tenant_fkey"
    FOREIGN KEY ("api_token_id", "workspace_id")
    REFERENCES "api_tokens"("id", "workspace_id")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "api_token_project_accesses_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "api_token_project_accesses_project_tenant_fkey"
    FOREIGN KEY ("project_id", "workspace_id")
    REFERENCES "projects"("id", "workspace_id")
    ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE INDEX "api_token_project_accesses_workspace_id_project_id_idx"
  ON "api_token_project_accesses"("workspace_id", "project_id");
