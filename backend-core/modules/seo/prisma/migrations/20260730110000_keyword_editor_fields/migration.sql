ALTER TABLE "keywords"
  ADD COLUMN "is_favorite" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "intent" VARCHAR(32);

ALTER TABLE "keywords"
  ADD CONSTRAINT "keywords_intent_check"
  CHECK (
    "intent" IS NULL OR
    "intent" IN (
      'INFORMATIONAL',
      'NAVIGATIONAL',
      'COMMERCIAL',
      'TRANSACTIONAL',
      'LOCAL',
      'MIXED'
    )
  );

CREATE INDEX "keywords_project_favorite_id_idx"
  ON "keywords" ("project_id", "is_favorite", "id")
  WHERE "status" = 'ACTIVE';
