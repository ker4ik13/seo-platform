CREATE TYPE "NotificationChannel" AS ENUM (
  'IN_APP',
  'EMAIL',
  'WEB_PUSH'
);

CREATE TYPE "NotificationEventType" AS ENUM (
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
);

CREATE TYPE "NotificationSeverity" AS ENUM (
  'INFO',
  'WARNING',
  'CRITICAL'
);

CREATE TYPE "NotificationDeliveryMode" AS ENUM (
  'INSTANT',
  'HOURLY_DIGEST',
  'DAILY_DIGEST'
);

CREATE TYPE "ProjectNotificationMode" AS ENUM (
  'INHERIT',
  'OVERRIDE',
  'PAUSED'
);

CREATE TYPE "ProjectNotificationSubscriptionStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE'
);

CREATE TABLE "notification_preferences" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "user_id" UUID NOT NULL,
  "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  "email_enabled" BOOLEAN NOT NULL DEFAULT false,
  "web_push_enabled" BOOLEAN NOT NULL DEFAULT false,
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "quiet_start" VARCHAR(5),
  "quiet_end" VARCHAR(5),
  "critical_bypass" BOOLEAN NOT NULL DEFAULT true,
  "digest_time" VARCHAR(5) NOT NULL DEFAULT '09:00',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_preferences_quiet_hours_check"
    CHECK (
      ("quiet_start" IS NULL AND "quiet_end" IS NULL)
      OR (
        "quiet_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND "quiet_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      )
    ),
  CONSTRAINT "notification_preferences_digest_time_check"
    CHECK ("digest_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

CREATE TABLE "project_notification_subscriptions" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "preference_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "membership_version" INTEGER NOT NULL,
  "mode" "ProjectNotificationMode" NOT NULL DEFAULT 'INHERIT',
  "paused_until" TIMESTAMPTZ(6),
  "notify_own_jobs" BOOLEAN NOT NULL DEFAULT true,
  "status" "ProjectNotificationSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deactivated_at" TIMESTAMPTZ(6),

  CONSTRAINT "project_notification_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_notification_subscriptions_preference_id_fkey"
    FOREIGN KEY ("preference_id")
    REFERENCES "notification_preferences"("id")
    ON DELETE CASCADE
);

CREATE TABLE "notification_rules" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "preference_id" UUID NOT NULL,
  "subscription_id" UUID,
  "scope_key" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "project_id" UUID,
  "event_type" "NotificationEventType" NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "minimum_severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
  "delivery_mode" "NotificationDeliveryMode" NOT NULL DEFAULT 'INSTANT',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_rules_preference_id_fkey"
    FOREIGN KEY ("preference_id")
    REFERENCES "notification_preferences"("id")
    ON DELETE CASCADE,
  CONSTRAINT "notification_rules_subscription_id_fkey"
    FOREIGN KEY ("subscription_id")
    REFERENCES "project_notification_subscriptions"("id")
    ON DELETE CASCADE,
  CONSTRAINT "notification_rules_scope_check"
    CHECK (
      ("subscription_id" IS NULL AND "project_id" IS NULL)
      OR ("subscription_id" IS NOT NULL AND "project_id" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "notification_preferences_user_id_key"
  ON "notification_preferences"("user_id");

CREATE UNIQUE INDEX "project_notification_subscription_membership_snapshot_key"
  ON "project_notification_subscriptions"(
    "user_id",
    "project_id",
    "membership_id",
    "membership_version"
  );

CREATE INDEX "project_notification_scope_status_user_idx"
  ON "project_notification_subscriptions"(
    "workspace_id",
    "project_id",
    "status",
    "user_id"
  );

CREATE INDEX "project_notification_subscriptions_membership_status_idx"
  ON "project_notification_subscriptions"("membership_id", "status");

CREATE UNIQUE INDEX "notification_rules_scope_event_channel_key"
  ON "notification_rules"("scope_key", "event_type", "channel");

CREATE INDEX "notification_rules_user_project_event_channel_idx"
  ON "notification_rules"(
    "user_id",
    "project_id",
    "event_type",
    "channel"
  );

CREATE INDEX "notification_rules_preference_subscription_idx"
  ON "notification_rules"("preference_id", "subscription_id");
