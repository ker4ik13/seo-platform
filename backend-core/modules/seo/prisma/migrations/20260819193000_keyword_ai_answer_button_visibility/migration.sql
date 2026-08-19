ALTER TABLE "keywords"
ADD COLUMN "show_ai_answer_button" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "keywords" AS keyword
SET "show_ai_answer_button" = TRUE
WHERE EXISTS (
  SELECT 1
  FROM "ai_answer_snapshots" AS snapshot
  WHERE snapshot."workspace_id" = keyword."workspace_id"
    AND snapshot."project_id" = keyword."project_id"
    AND snapshot."keyword_id" = keyword."id"
    AND snapshot."answer_present" = TRUE
);
