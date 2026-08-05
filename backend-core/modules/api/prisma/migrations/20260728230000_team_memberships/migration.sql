CREATE TYPE "WorkspaceInviteStatus" AS ENUM (
    'SENT',
    'DELIVERED',
    'ACCEPTED',
    'EXPIRED',
    'REVOKED',
    'BOUNCED'
);

CREATE TYPE "ProjectAccessLevel" AS ENUM (
    'NONE',
    'VIEWER',
    'MEMBER',
    'MANAGER'
);

ALTER TABLE "workspace_members"
ADD COLUMN "all_projects" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "invited_by" UUID;

CREATE TABLE "workspace_invites" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "email_normalized" VARCHAR(320) NOT NULL,
    "email_display" VARCHAR(320) NOT NULL,
    "role_code" VARCHAR(64) NOT NULL,
    "all_projects" BOOLEAN NOT NULL DEFAULT true,
    "project_accesses" JSONB NOT NULL,
    "message" TEXT,
    "token_hash" TEXT NOT NULL,
    "status" "WorkspaceInviteStatus" NOT NULL DEFAULT 'SENT',
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_member_access" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "project_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "level" "ProjectAccessLevel" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_member_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_invites_token_hash_key"
ON "workspace_invites"("token_hash");

CREATE INDEX "workspace_invites_workspace_id_status_created_at_idx"
ON "workspace_invites"("workspace_id", "status", "created_at");

CREATE INDEX "workspace_invites_email_normalized_status_idx"
ON "workspace_invites"("email_normalized", "status");

CREATE UNIQUE INDEX "workspace_invites_active_email_key"
ON "workspace_invites"("workspace_id", "email_normalized")
WHERE "status" IN ('SENT', 'DELIVERED');

CREATE UNIQUE INDEX "project_member_access_project_id_member_id_key"
ON "project_member_access"("project_id", "member_id");

CREATE INDEX "project_member_access_member_id_level_idx"
ON "project_member_access"("member_id", "level");

ALTER TABLE "workspace_invites"
ADD CONSTRAINT "workspace_invites_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_member_access"
ADD CONSTRAINT "project_member_access_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_member_access"
ADD CONSTRAINT "project_member_access_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "workspace_members"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
