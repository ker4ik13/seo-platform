ALTER TABLE "crawl_page_snapshots"
  ADD COLUMN "redirect_chain" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "crawl_page_snapshots"
  ALTER COLUMN "redirect_chain" DROP DEFAULT;

ALTER TABLE "crawl_page_snapshots"
  ADD CONSTRAINT "crawl_page_snapshots_redirect_chain_check"
  CHECK (
    jsonb_typeof("redirect_chain") = 'array' AND
    jsonb_array_length("redirect_chain") <= 10
  );

CREATE TABLE "crawl_page_changes" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "page_id" UUID NOT NULL,
  "crawl_id" UUID NOT NULL,
  "previous_snapshot_id" UUID NOT NULL,
  "current_snapshot_id" UUID NOT NULL,
  "severity" "CrawlIssueSeverity" NOT NULL,
  "source" VARCHAR(32) NOT NULL DEFAULT 'TECHNICAL_CRAWL',
  "changed_fields" VARCHAR(64)[] NOT NULL,
  "before_hash" CHAR(64) NOT NULL,
  "after_hash" CHAR(64) NOT NULL,
  "diff_hash" CHAR(64) NOT NULL,
  "diff" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crawl_page_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crawl_page_changes_snapshot_pair_check"
    CHECK ("previous_snapshot_id" <> "current_snapshot_id"),
  CONSTRAINT "crawl_page_changes_hash_check" CHECK (
    "before_hash" ~ '^[0-9a-f]{64}$' AND
    "after_hash" ~ '^[0-9a-f]{64}$' AND
    "diff_hash" ~ '^[0-9a-f]{64}$' AND
    "before_hash" <> "after_hash"
  ),
  CONSTRAINT "crawl_page_changes_diff_check" CHECK (
    jsonb_typeof("diff") = 'object' AND
    jsonb_typeof("diff"->'fields') = 'array' AND
    cardinality("changed_fields") BETWEEN 1 AND 24 AND
    "changed_fields" <@ ARRAY[
      'statusCode', 'redirectChain', 'title', 'description', 'h1',
      'h1Count', 'headings', 'canonicalUrl', 'robots', 'language',
      'hreflang', 'internalLinks', 'externalLinks', 'imageCount',
      'imagesMissingAlt', 'structuredDataTypes', 'wordCount',
      'contentHash', 'indexability', 'responseTimeMs', 'sizeBytes'
    ]::VARCHAR(64)[]
  ),
  CONSTRAINT "crawl_page_changes_source_check"
    CHECK ("source" = 'TECHNICAL_CRAWL')
);

CREATE UNIQUE INDEX "crawl_page_changes_current_snapshot_key"
  ON "crawl_page_changes"("current_snapshot_id");
CREATE UNIQUE INDEX "crawl_page_changes_tenant_project_id_key"
  ON "crawl_page_changes"("workspace_id", "project_id", "id");
CREATE INDEX "crawl_page_changes_project_created_idx"
  ON "crawl_page_changes"(
    "workspace_id", "project_id", "created_at" DESC, "id" DESC
  );
CREATE INDEX "crawl_page_changes_page_created_idx"
  ON "crawl_page_changes"(
    "workspace_id", "project_id", "page_id", "created_at" DESC
  );

ALTER TABLE "crawl_page_changes"
  ADD CONSTRAINT "crawl_page_changes_page_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "page_id")
  REFERENCES "pages"("workspace_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "crawl_page_changes"
  ADD CONSTRAINT "crawl_page_changes_previous_snapshot_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "previous_snapshot_id")
  REFERENCES "crawl_page_snapshots"("workspace_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "crawl_page_changes"
  ADD CONSTRAINT "crawl_page_changes_current_snapshot_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "current_snapshot_id")
  REFERENCES "crawl_page_snapshots"("workspace_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER crawl_page_changes_immutable_trigger
  BEFORE UPDATE OR DELETE ON "crawl_page_changes"
  FOR EACH ROW EXECUTE FUNCTION reject_crawl_snapshot_mutation();
