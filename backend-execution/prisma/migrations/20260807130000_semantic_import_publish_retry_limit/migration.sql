BEGIN;

ALTER TABLE "semantic_imports"
ADD COLUMN "publishing_attempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "semantic_imports"
ADD CONSTRAINT "semantic_imports_publishing_attempts_non_negative"
CHECK ("publishing_attempts" >= 0);

COMMIT;
