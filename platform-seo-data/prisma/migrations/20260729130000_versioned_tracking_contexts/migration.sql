BEGIN;

-- The foundation table stored an unversioned provider-shaped JSON document.
-- Freeze every table that could contain legacy context-dependent data before
-- checking the destructive migration precondition. Environments with rows
-- require an explicit inspect/backfill/validate/contract migration.
LOCK TABLE
  "tracking_contexts",
  "rank_snapshots",
  "current_ranks"
IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tracking_contexts")
    OR EXISTS (SELECT 1 FROM "rank_snapshots")
    OR EXISTS (SELECT 1 FROM "current_ranks")
  THEN
    RAISE EXCEPTION
      'versioned tracking context migration requires empty pre-release tracking_contexts, rank_snapshots and current_ranks tables';
  END IF;
END
$$;

DROP TABLE "tracking_contexts";

CREATE TYPE "TrackingContextStatus" AS ENUM (
  'ACTIVE',
  'ARCHIVED'
);

CREATE TYPE "TrackingSearchEngine" AS ENUM (
  'GOOGLE',
  'YANDEX'
);

CREATE TYPE "TrackingDevice" AS ENUM (
  'DESKTOP',
  'MOBILE'
);

CREATE TYPE "TrackingDomainMatchMode" AS ENUM (
  'EXACT_HOST',
  'INCLUDE_WWW',
  'INCLUDE_SUBDOMAINS',
  'CANONICAL_DOMAIN',
  'ANY_PROJECT_MIRROR',
  'SPECIFIC_URL',
  'URL_PREFIX'
);

CREATE TABLE "tracking_contexts" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "status" "TrackingContextStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "archived_by" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "tracking_contexts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tracking_contexts_name_not_blank"
    CHECK (length(btrim("name")) BETWEEN 1 AND 160),
  CONSTRAINT "tracking_contexts_version_positive"
    CHECK ("version" > 0),
  CONSTRAINT "tracking_contexts_archive_consistent"
    CHECK (
      (
        "status" = 'ACTIVE'
        AND "archived_by" IS NULL
        AND "archived_at" IS NULL
      )
      OR
      (
        "status" = 'ARCHIVED'
        AND "archived_by" IS NOT NULL
        AND "archived_at" IS NOT NULL
      )
    )
);

CREATE TABLE "tracking_context_versions" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "context_id" UUID NOT NULL,
  "configuration_version" INTEGER NOT NULL,
  "search_engine" "TrackingSearchEngine" NOT NULL,
  "country_code" CHAR(2) NOT NULL,
  "region_code" VARCHAR(100),
  "region_label" VARCHAR(160),
  "language" VARCHAR(16) NOT NULL,
  "device" "TrackingDevice" NOT NULL,
  "depth" INTEGER NOT NULL,
  "domain_match_mode" "TrackingDomainMatchMode" NOT NULL,
  "domain_match_value" TEXT,
  "safe_search" BOOLEAN NOT NULL,
  "configuration_hash" CHAR(64) NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tracking_context_versions_pkey"
    PRIMARY KEY ("context_id", "configuration_version"),
  CONSTRAINT "tracking_context_versions_number_positive"
    CHECK ("configuration_version" > 0),
  CONSTRAINT "tracking_context_versions_country_code"
    CHECK ("country_code" ~ '^[A-Z]{2}$'),
  CONSTRAINT "tracking_context_versions_region_code_not_blank"
    CHECK (
      "region_code" IS NULL
      OR length(btrim("region_code")) BETWEEN 1 AND 100
    ),
  CONSTRAINT "tracking_context_versions_region_label_not_blank"
    CHECK (
      "region_label" IS NULL
      OR length(btrim("region_label")) BETWEEN 1 AND 160
    ),
  CONSTRAINT "tracking_context_versions_region_label_requires_code"
    CHECK (
      "region_label" IS NULL
      OR "region_code" IS NOT NULL
    ),
  CONSTRAINT "tracking_context_versions_language_not_blank"
    CHECK (length(btrim("language")) BETWEEN 1 AND 16),
  CONSTRAINT "tracking_context_versions_depth_allowed"
    CHECK ("depth" IN (30, 50, 100)),
  CONSTRAINT "tracking_context_versions_domain_rule_consistent"
    CHECK (
      (
        "domain_match_mode" IN (
          'EXACT_HOST',
          'INCLUDE_WWW',
          'INCLUDE_SUBDOMAINS',
          'CANONICAL_DOMAIN',
          'ANY_PROJECT_MIRROR'
        )
        AND "domain_match_value" IS NULL
      )
      OR
      (
        "domain_match_mode" IN ('SPECIFIC_URL', 'URL_PREFIX')
        AND "domain_match_value" IS NOT NULL
        AND length(btrim("domain_match_value")) > 0
      )
    ),
  CONSTRAINT "tracking_context_versions_configuration_hash"
    CHECK ("configuration_hash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "tracking_context_keyword_assignments" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "context_id" UUID NOT NULL,
  "keyword_id" UUID NOT NULL,
  "assigned_by" UUID NOT NULL,
  "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_by" UUID,
  "removed_at" TIMESTAMPTZ(6),

  CONSTRAINT "tracking_context_keyword_assignments_pkey"
    PRIMARY KEY ("id"),
  CONSTRAINT "tracking_context_assignments_removal_consistent"
    CHECK (
      (
        "removed_by" IS NULL
        AND "removed_at" IS NULL
      )
      OR
      (
        "removed_by" IS NOT NULL
        AND "removed_at" IS NOT NULL
        AND "removed_at" >= "assigned_at"
      )
    )
);

CREATE TABLE "tracking_context_create_receipts" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "context_id" UUID NOT NULL,
  "response_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tracking_context_create_receipts_pkey"
    PRIMARY KEY (
      "workspace_id",
      "project_id",
      "actor_id",
      "idempotency_key"
    ),
  CONSTRAINT "tracking_context_create_receipts_key_valid"
    CHECK (
      "idempotency_key" ~ '^[A-Za-z0-9._:-]{8,180}$'
    ),
  CONSTRAINT "tracking_context_create_receipts_request_hash_length"
    CHECK (octet_length("request_hash") = 32),
  CONSTRAINT "tracking_context_create_receipts_snapshot_object"
    CHECK (jsonb_typeof("response_snapshot") = 'object')
);

CREATE UNIQUE INDEX "keywords_tenant_project_id_key"
  ON "keywords" ("workspace_id", "project_id", "id");

CREATE UNIQUE INDEX "tracking_contexts_tenant_project_id_key"
  ON "tracking_contexts" ("workspace_id", "project_id", "id");

CREATE INDEX "tracking_contexts_tenant_project_status_created_idx"
  ON "tracking_contexts" (
    "workspace_id",
    "project_id",
    "status",
    "created_at",
    "id"
  );

CREATE UNIQUE INDEX
  "tracking_context_versions_tenant_project_context_version_key"
  ON "tracking_context_versions" (
    "workspace_id",
    "project_id",
    "context_id",
    "configuration_version"
  );

CREATE INDEX "tracking_context_versions_current_idx"
  ON "tracking_context_versions" (
    "workspace_id",
    "project_id",
    "context_id",
    "configuration_version" DESC
  );

CREATE UNIQUE INDEX "tracking_context_assignments_active_key"
  ON "tracking_context_keyword_assignments" (
    "workspace_id",
    "project_id",
    "context_id",
    "keyword_id"
  )
  WHERE "removed_at" IS NULL;

CREATE INDEX "tracking_context_assignments_context_current_idx"
  ON "tracking_context_keyword_assignments" (
    "workspace_id",
    "project_id",
    "context_id",
    "removed_at",
    "assigned_at" DESC,
    "id" DESC
  );

CREATE INDEX "tracking_context_assignments_keyword_current_idx"
  ON "tracking_context_keyword_assignments" (
    "workspace_id",
    "project_id",
    "keyword_id",
    "removed_at",
    "context_id"
  );

CREATE INDEX "tracking_context_create_receipts_context_idx"
  ON "tracking_context_create_receipts" (
    "workspace_id",
    "project_id",
    "context_id"
  );

ALTER TABLE "tracking_context_versions"
  ADD CONSTRAINT "tracking_context_versions_context_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "context_id")
  REFERENCES "tracking_contexts" ("workspace_id", "project_id", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "tracking_context_keyword_assignments"
  ADD CONSTRAINT "tracking_context_assignments_context_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "context_id")
  REFERENCES "tracking_contexts" ("workspace_id", "project_id", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE,
  ADD CONSTRAINT "tracking_context_assignments_keyword_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "keyword_id")
  REFERENCES "keywords" ("workspace_id", "project_id", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "tracking_context_create_receipts"
  ADD CONSTRAINT "tracking_context_create_receipts_context_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "context_id")
  REFERENCES "tracking_contexts" ("workspace_id", "project_id", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

COMMIT;
