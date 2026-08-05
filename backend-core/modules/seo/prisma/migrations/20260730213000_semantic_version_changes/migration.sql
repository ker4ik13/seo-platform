BEGIN;

ALTER TABLE "semantic_versions"
  ADD COLUMN "source_job_id" UUID,
  ADD COLUMN "parent_version_id" UUID,
  ADD COLUMN "summary" VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN "affected_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reversible" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "finalized_at" TIMESTAMPTZ(6);

UPDATE "semantic_versions"
SET
  "summary" = CASE
    WHEN "reason" = 'semantic_import' THEN 'Импорт семантического ядра'
    ELSE "reason"
  END,
  "finalized_at" = "created_at"
WHERE "finalized_at" IS NULL;

ALTER TABLE "semantic_versions"
  ADD CONSTRAINT "semantic_versions_affected_count_check"
  CHECK ("affected_count" >= 0);

CREATE UNIQUE INDEX "semantic_versions_tenant_project_id_key"
  ON "semantic_versions" ("workspace_id", "project_id", "id");

CREATE INDEX "semantic_versions_parent_idx"
  ON "semantic_versions" ("workspace_id", "project_id", "parent_version_id");

ALTER TABLE "semantic_versions"
  ADD CONSTRAINT "semantic_versions_parent_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "parent_version_id")
  REFERENCES "semantic_versions" ("workspace_id", "project_id", "id")
  ON DELETE RESTRICT
  ON UPDATE RESTRICT;

CREATE TABLE "semantic_entity_changes" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "semantic_version_id" UUID NOT NULL,
  "entity_type" VARCHAR(32) NOT NULL,
  "entity_id" UUID NOT NULL,
  "operation" VARCHAR(16) NOT NULL,
  "before_state" JSONB,
  "after_state" JSONB NOT NULL,
  "before_version" INTEGER,
  "after_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "semantic_entity_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "semantic_entity_changes_entity_type_check"
    CHECK ("entity_type" IN ('KEYWORD')),
  CONSTRAINT "semantic_entity_changes_operation_check"
    CHECK ("operation" IN ('CREATE', 'UPDATE', 'DELETE')),
  CONSTRAINT "semantic_entity_changes_versions_check"
    CHECK (
      "after_version" >= 1
      AND (
        ("operation" = 'CREATE' AND "before_state" IS NULL AND "before_version" IS NULL)
        OR
        ("operation" IN ('UPDATE', 'DELETE') AND "before_state" IS NOT NULL AND "before_version" >= 1)
      )
    ),
  CONSTRAINT "semantic_entity_changes_semantic_version_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "semantic_version_id")
    REFERENCES "semantic_versions" ("workspace_id", "project_id", "id")
    ON DELETE CASCADE
    ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "semantic_entity_changes_version_entity_key"
  ON "semantic_entity_changes" ("semantic_version_id", "entity_type", "entity_id");

CREATE INDEX "semantic_entity_changes_entity_history_idx"
  ON "semantic_entity_changes"
  ("workspace_id", "project_id", "entity_type", "entity_id", "created_at" DESC);

CREATE TABLE "semantic_undo_receipts" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "source_version_id" UUID NOT NULL,
  "created_version_id" UUID,
  "applied" INTEGER NOT NULL,
  "conflicted" INTEGER NOT NULL,
  "unsupported" INTEGER NOT NULL,
  "changes" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "semantic_undo_receipts_pkey"
    PRIMARY KEY ("workspace_id", "project_id", "actor_id", "idempotency_key"),
  CONSTRAINT "semantic_undo_receipts_idempotency_key_check"
    CHECK ("idempotency_key" ~ '^[A-Za-z0-9._:-]{8,180}$'),
  CONSTRAINT "semantic_undo_receipts_counts_check"
    CHECK (
      "applied" >= 0
      AND "conflicted" >= 0
      AND "unsupported" >= 0
    ),
  CONSTRAINT "semantic_undo_receipts_source_version_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "source_version_id")
    REFERENCES "semantic_versions" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  CONSTRAINT "semantic_undo_receipts_created_version_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "created_version_id")
    REFERENCES "semantic_versions" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE INDEX "semantic_undo_receipts_source_idx"
  ON "semantic_undo_receipts"
  ("workspace_id", "project_id", "source_version_id", "created_at" DESC);

COMMIT;
