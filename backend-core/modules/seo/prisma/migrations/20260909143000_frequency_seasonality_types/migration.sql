BEGIN;

ALTER TABLE "frequency_seasonality_points"
  ADD COLUMN "type" VARCHAR(64) NOT NULL DEFAULT 'BASE';
ALTER TABLE "frequency_seasonality_points"
  ALTER COLUMN "type" DROP DEFAULT;

ALTER TABLE "frequency_seasonality_points"
  DROP CONSTRAINT "frequency_seasonality_points_shape";
ALTER TABLE "frequency_seasonality_points"
  ADD CONSTRAINT "frequency_seasonality_points_shape" CHECK (
    "type" IN ('BASE', 'EXACT', 'FIXED')
    AND "granularity" IN ('MONTH', 'WEEK', 'DAY')
    AND "value" >= 0
    AND ("share" IS NULL OR ("share" >= 0 AND "share" <= 1))
    AND length("region_code") BETWEEN 1 AND 100
    AND "device" IN ('ALL', 'DESKTOP', 'MOBILE', 'PHONE_ONLY', 'TABLET_ONLY')
    AND "provider" IN ('XMLSTOCK', 'ARSENKIN')
    AND "source_mode" IN ('BYOK', 'PLATFORM')
  );

DROP INDEX "frequency_seasonality_points_job_keyword_period_key";
CREATE UNIQUE INDEX "frequency_seasonality_points_job_keyword_period_key"
  ON "frequency_seasonality_points"(
    "workspace_id", "project_id", "job_id", "keyword_id", "type",
    "granularity", "period_start", "region_code", "device"
  );

DROP INDEX "frequency_seasonality_points_keyword_period_idx";
CREATE INDEX "frequency_seasonality_points_keyword_period_idx"
  ON "frequency_seasonality_points"(
    "workspace_id", "project_id", "keyword_id", "region_code", "device",
    "type", "granularity", "period_start"
  );

COMMIT;
