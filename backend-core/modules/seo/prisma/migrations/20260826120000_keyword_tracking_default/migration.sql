-- Manual keywords historically inherited false from the legacy compatibility
-- column while imports explicitly wrote true. There was no user-facing switch,
-- so every existing active/deleted keyword is safe to backfill before the
-- column becomes the authoritative per-keyword tracking preference.
UPDATE "keywords"
SET "is_tracked" = true
WHERE "is_tracked" = false;

ALTER TABLE "keywords"
ALTER COLUMN "is_tracked" SET DEFAULT true;
