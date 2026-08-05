CREATE TYPE "PageType" AS ENUM (
  'EXISTING',
  'PLANNED',
  'REDIRECTED',
  'DELETED',
  'EXTERNAL',
  'UNKNOWN'
);

CREATE TYPE "PageIndexability" AS ENUM (
  'UNKNOWN',
  'INDEXABLE',
  'NOINDEX',
  'BLOCKED_ROBOTS',
  'CANONICALIZED',
  'REDIRECTED',
  'ERROR'
);

CREATE TYPE "PageSourceType" AS ENUM (
  'CRAWL',
  'SITEMAP',
  'SEARCH_CONSOLE',
  'WEBMASTER',
  'ANALYTICS',
  'MANUAL',
  'IMPORT',
  'CMS'
);

ALTER TABLE "pages"
  ADD COLUMN "page_type" "PageType" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "indexability" "PageIndexability" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "http_status" INTEGER,
  ADD COLUMN "canonical_target" TEXT,
  ADD COLUMN "robots" VARCHAR(255),
  ADD COLUMN "description" TEXT,
  ADD COLUMN "h1" TEXT,
  ADD COLUMN "language" VARCHAR(16),
  ADD COLUMN "template" VARCHAR(160),
  ADD COLUMN "owner_id" UUID,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "published_at" TIMESTAMPTZ(6),
  ADD COLUMN "crawled_at" TIMESTAMPTZ(6),
  ADD COLUMN "analytics_metrics" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID,
  ADD COLUMN "archived_by" UUID,
  ADD COLUMN "archived_at" TIMESTAMPTZ(6);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "pages" WHERE "status" <> 'ACTIVE'
  ) THEN
    RAISE EXCEPTION
      'Cannot infer legacy Page archive provenance; restore or migrate non-active pages explicitly';
  END IF;
END
$$;

ALTER TABLE "pages"
  ADD CONSTRAINT "pages_tenant_project_id_key"
    UNIQUE ("workspace_id", "project_id", "id"),
  ADD CONSTRAINT "pages_url_hash_check"
    CHECK ("url_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "pages_http_status_check"
    CHECK ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599),
  ADD CONSTRAINT "pages_priority_check"
    CHECK ("priority" BETWEEN 0 AND 100),
  ADD CONSTRAINT "pages_version_check"
    CHECK ("version" > 0),
  ADD CONSTRAINT "pages_lifecycle_check"
    CHECK (
      ("status" = 'ACTIVE' AND "archived_at" IS NULL AND "archived_by" IS NULL)
      OR
      ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL AND "archived_by" IS NOT NULL)
      OR
      ("status" = 'DELETED')
    );

CREATE INDEX "pages_project_status_updated_id_idx"
  ON "pages" ("workspace_id", "project_id", "status", "updated_at" DESC, "id" DESC);
CREATE INDEX "pages_project_type_status_idx"
  ON "pages" ("workspace_id", "project_id", "page_type", "status", "id");
CREATE INDEX "pages_project_indexability_status_idx"
  ON "pages" ("workspace_id", "project_id", "indexability", "status", "id");

CREATE TABLE "page_aliases" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "page_id" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "normalized_url" TEXT NOT NULL,
  "url_hash" CHAR(64) NOT NULL,
  "source" "PageSourceType" NOT NULL,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "page_aliases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "page_aliases_project_id_url_hash_key"
    UNIQUE ("project_id", "url_hash"),
  CONSTRAINT "page_aliases_url_hash_check"
    CHECK ("url_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_aliases_seen_order_check"
    CHECK ("last_seen_at" >= "first_seen_at"),
  CONSTRAINT "page_aliases_page_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "page_id")
    REFERENCES "pages" ("workspace_id", "project_id", "id")
    ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE INDEX "page_aliases_tenant_page_idx"
  ON "page_aliases" ("workspace_id", "project_id", "page_id", "id");

CREATE TABLE "page_sources" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "page_id" UUID NOT NULL,
  "source" "PageSourceType" NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "page_sources_pkey" PRIMARY KEY ("page_id", "source"),
  CONSTRAINT "page_sources_seen_order_check"
    CHECK ("last_seen_at" >= "first_seen_at"),
  CONSTRAINT "page_sources_page_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "page_id")
    REFERENCES "pages" ("workspace_id", "project_id", "id")
    ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE INDEX "page_sources_tenant_source_idx"
  ON "page_sources" ("workspace_id", "project_id", "source", "page_id");

CREATE TABLE "page_create_receipts" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "page_id" UUID NOT NULL,
  "response_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "page_create_receipts_pkey"
    PRIMARY KEY ("workspace_id", "project_id", "actor_id", "idempotency_key"),
  CONSTRAINT "page_create_receipts_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "page_create_receipts_page_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "page_id")
    REFERENCES "pages" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "page_create_receipts_tenant_page_idx"
  ON "page_create_receipts" ("workspace_id", "project_id", "page_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "keywords" AS keyword
    LEFT JOIN "pages" AS page
      ON page."workspace_id" = keyword."workspace_id"
      AND page."project_id" = keyword."project_id"
      AND page."id" = keyword."target_page_id"
    WHERE keyword."target_page_id" IS NOT NULL
      AND page."id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot add tenant-safe keyword target page FK: invalid target_page_id exists';
  END IF;
END
$$;

ALTER TABLE "keywords"
  ADD CONSTRAINT "keywords_target_page_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "target_page_id")
    REFERENCES "pages" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION "assert_page_url_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW."project_id"::text || ':' || NEW."url_hash", 0)
  );

  IF TG_TABLE_NAME = 'pages' THEN
    IF EXISTS (
      SELECT 1
      FROM "page_aliases"
      WHERE "project_id" = NEW."project_id"
        AND "url_hash" = NEW."url_hash"
    ) THEN
      RAISE EXCEPTION 'Page canonical URL conflicts with an existing alias'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM "pages"
      WHERE "project_id" = NEW."project_id"
        AND "url_hash" = NEW."url_hash"
    ) THEN
      RAISE EXCEPTION 'Page alias conflicts with an existing canonical URL'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "pages_url_identity_trigger"
BEFORE INSERT OR UPDATE OF "project_id", "url_hash"
ON "pages"
FOR EACH ROW
EXECUTE FUNCTION "assert_page_url_identity"();

CREATE TRIGGER "page_aliases_url_identity_trigger"
BEFORE INSERT OR UPDATE OF "project_id", "page_id", "url_hash"
ON "page_aliases"
FOR EACH ROW
EXECUTE FUNCTION "assert_page_url_identity"();
