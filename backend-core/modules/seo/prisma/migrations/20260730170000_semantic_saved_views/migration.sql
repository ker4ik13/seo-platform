CREATE TYPE "SemanticSavedViewScope"
AS ENUM ('PRIVATE', 'PROJECT_SHARED');

CREATE TABLE "semantic_saved_views" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "scope" "SemanticSavedViewScope" NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "normalized_name" VARCHAR(160) NOT NULL,
  "config" JSONB NOT NULL,
  "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "semantic_saved_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "semantic_saved_views_name_not_blank"
    CHECK (length(btrim("name")) BETWEEN 1 AND 160),
  CONSTRAINT "semantic_saved_views_normalized_name_not_blank"
    CHECK (length(btrim("normalized_name")) BETWEEN 1 AND 160),
  CONSTRAINT "semantic_saved_views_config_object"
    CHECK (jsonb_typeof("config") = 'object'),
  CONSTRAINT "semantic_saved_views_version_positive"
    CHECK ("version" > 0),
  CONSTRAINT "semantic_saved_views_delete_consistent"
    CHECK (
      ("status" = 'ACTIVE' AND "deleted_at" IS NULL)
      OR ("status" = 'DELETED' AND "deleted_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "semantic_saved_views_tenant_project_id_key"
ON "semantic_saved_views"("workspace_id", "project_id", "id");

CREATE UNIQUE INDEX "semantic_saved_views_private_name_key"
ON "semantic_saved_views"(
  "workspace_id",
  "project_id",
  "owner_id",
  "normalized_name"
)
WHERE "status" = 'ACTIVE' AND "scope" = 'PRIVATE';

CREATE UNIQUE INDEX "semantic_saved_views_shared_name_key"
ON "semantic_saved_views"(
  "workspace_id",
  "project_id",
  "normalized_name"
)
WHERE "status" = 'ACTIVE' AND "scope" = 'PROJECT_SHARED';

CREATE INDEX "semantic_saved_views_project_scope_status_updated_idx"
ON "semantic_saved_views"(
  "workspace_id",
  "project_id",
  "scope",
  "status",
  "updated_at" DESC,
  "id" DESC
);

CREATE INDEX "semantic_saved_views_owner_status_updated_idx"
ON "semantic_saved_views"(
  "workspace_id",
  "project_id",
  "owner_id",
  "status",
  "updated_at" DESC,
  "id" DESC
);
