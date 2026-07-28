ALTER TABLE "notifications"
  ADD COLUMN "project_id" UUID,
  ADD COLUMN "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
  ADD COLUMN "actor_id" UUID,
  ADD COLUMN "resource_type" VARCHAR(64),
  ADD COLUMN "resource_id" UUID,
  ADD COLUMN "deep_link" VARCHAR(600);

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_event_type_check"
  CHECK (
    "type" IN (
      'ASSIGNMENT',
      'MENTION',
      'SEMANTIC_IMPORT',
      'RANK_TRACKING',
      'FREQUENCY_COLLECTION',
      'SERP_COLLECTION',
      'CLUSTERING',
      'CRAWL_RADAR',
      'SITEMAP',
      'MAGNET',
      'AUTOMATION',
      'INTEGRATION',
      'JOB',
      'REPORT',
      'SECURITY',
      'BILLING',
      'PRODUCT'
    )
  ),
  ADD CONSTRAINT "notifications_resource_check"
  CHECK (
    ("resource_type" IS NULL AND "resource_id" IS NULL)
    OR ("resource_type" IS NOT NULL AND "resource_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "notifications_deep_link_check"
  CHECK (
    "deep_link" IS NULL
    OR (
      "deep_link" ~ '^/app(/|$)'
      AND "deep_link" !~ '[[:cntrl:]]'
    )
  );

CREATE INDEX "notifications_user_created_id_idx"
  ON "notifications"("user_id", "created_at" DESC, "id" DESC);

CREATE INDEX "notifications_user_read_created_id_idx"
  ON "notifications"(
    "user_id",
    "read_at",
    "created_at" DESC,
    "id" DESC
  );
