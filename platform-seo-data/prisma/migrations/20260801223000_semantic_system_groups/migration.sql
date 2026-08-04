CREATE TYPE "KeywordGroupSystemKind" AS ENUM ('UNGROUPED', 'TRASH');

ALTER TABLE "keyword_groups"
  ADD COLUMN "system_kind" "KeywordGroupSystemKind";

CREATE UNIQUE INDEX "keyword_groups_active_system_kind_key"
  ON "keyword_groups" ("project_id", "system_kind")
  WHERE "system_kind" IS NOT NULL AND "status" = 'ACTIVE';
