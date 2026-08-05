CREATE TYPE "CrawlIssueSeverity" AS ENUM (
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL'
);

CREATE TABLE "crawl_page_snapshots" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "crawl_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "page_id" UUID NOT NULL,
  "requested_url" TEXT NOT NULL,
  "final_url" TEXT NOT NULL,
  "final_url_hash" CHAR(64) NOT NULL,
  "depth" INTEGER NOT NULL,
  "status_code" INTEGER NOT NULL,
  "response_time_ms" INTEGER NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "content_type" VARCHAR(160) NOT NULL,
  "title" TEXT,
  "description" TEXT,
  "h1" TEXT,
  "h1_count" INTEGER NOT NULL,
  "canonical_url" TEXT,
  "robots" VARCHAR(255),
  "language" VARCHAR(16),
  "headings" JSONB NOT NULL,
  "hreflang" JSONB NOT NULL,
  "internal_links" JSONB NOT NULL,
  "external_links" JSONB NOT NULL,
  "image_count" INTEGER NOT NULL,
  "images_missing_alt" INTEGER NOT NULL,
  "structured_data_types" JSONB NOT NULL,
  "word_count" INTEGER NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "indexability" "PageIndexability" NOT NULL,
  "crawled_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crawl_page_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crawl_page_snapshots_bounds_check" CHECK (
    "sequence" > 0 AND "depth" >= 0 AND
    "status_code" BETWEEN 100 AND 599 AND
    "response_time_ms" >= 0 AND "size_bytes" >= 0 AND
    "h1_count" >= 0 AND "image_count" >= 0 AND
    "images_missing_alt" >= 0 AND
    "images_missing_alt" <= "image_count" AND "word_count" >= 0
  ),
  CONSTRAINT "crawl_page_snapshots_hash_check" CHECK (
    "final_url_hash" ~ '^[0-9a-f]{64}$' AND
    "content_hash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "crawl_page_snapshots_crawl_sequence_key"
  ON "crawl_page_snapshots"("crawl_id", "sequence");
CREATE UNIQUE INDEX "crawl_page_snapshots_crawl_url_key"
  ON "crawl_page_snapshots"("crawl_id", "final_url_hash");
CREATE UNIQUE INDEX "crawl_page_snapshots_tenant_project_id_key"
  ON "crawl_page_snapshots"("workspace_id", "project_id", "id");
CREATE INDEX "crawl_page_snapshots_project_crawled_idx"
  ON "crawl_page_snapshots"("workspace_id", "project_id", "crawled_at" DESC);
CREATE INDEX "crawl_page_snapshots_page_crawled_idx"
  ON "crawl_page_snapshots"("workspace_id", "project_id", "page_id", "crawled_at" DESC);

ALTER TABLE "crawl_page_snapshots"
  ADD CONSTRAINT "crawl_page_snapshots_page_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "page_id")
  REFERENCES "pages"("workspace_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "crawl_issues" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "page_id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "severity" "CrawlIssueSeverity" NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "details" JSONB NOT NULL,
  "first_crawl_id" UUID NOT NULL,
  "last_crawl_id" UUID NOT NULL,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
  "resolved_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crawl_issues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crawl_issues_counts_check" CHECK (
    "occurrences" > 0 AND "version" > 0 AND
    "last_seen_at" >= "first_seen_at"
  )
);

CREATE UNIQUE INDEX "crawl_issues_project_page_code_key"
  ON "crawl_issues"("project_id", "page_id", "code");
CREATE UNIQUE INDEX "crawl_issues_tenant_project_id_key"
  ON "crawl_issues"("workspace_id", "project_id", "id");
CREATE INDEX "crawl_issues_project_status_idx"
  ON "crawl_issues"("workspace_id", "project_id", "resolved_at", "severity", "last_seen_at" DESC);

ALTER TABLE "crawl_issues"
  ADD CONSTRAINT "crawl_issues_page_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "page_id")
  REFERENCES "pages"("workspace_id", "project_id", "id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE TABLE "crawl_issue_occurrences" (
  "snapshot_id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "severity" "CrawlIssueSeverity" NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "details" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crawl_issue_occurrences_pkey" PRIMARY KEY ("snapshot_id", "code"),
  CONSTRAINT "crawl_issue_occurrences_snapshot_fkey"
    FOREIGN KEY ("snapshot_id")
    REFERENCES "crawl_page_snapshots"("id")
    ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE OR REPLACE FUNCTION reject_crawl_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crawl snapshots and issue occurrences are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER crawl_page_snapshots_immutable_trigger
  BEFORE UPDATE OR DELETE ON "crawl_page_snapshots"
  FOR EACH ROW EXECUTE FUNCTION reject_crawl_snapshot_mutation();

CREATE TRIGGER crawl_issue_occurrences_immutable_trigger
  BEFORE UPDATE OR DELETE ON "crawl_issue_occurrences"
  FOR EACH ROW EXECUTE FUNCTION reject_crawl_snapshot_mutation();
