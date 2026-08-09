CREATE TYPE "ProjectNoteVisibility" AS ENUM ('PROJECT_MEMBERS', 'PUBLIC');

CREATE TABLE "project_notes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "markdown" TEXT NOT NULL,
    "visibility" "ProjectNoteVisibility" NOT NULL DEFAULT 'PROJECT_MEMBERS',
    "public_token" VARCHAR(64),
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "project_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_notes_public_token_key"
ON "project_notes"("public_token");

CREATE UNIQUE INDEX "project_notes_tenant_project_id_key"
ON "project_notes"("workspace_id", "project_id", "id");

CREATE INDEX "project_notes_project_updated_idx"
ON "project_notes"("workspace_id", "project_id", "archived_at", "updated_at" DESC, "id" DESC);
