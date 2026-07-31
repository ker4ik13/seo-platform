CREATE TYPE "CrawlMembershipStatus" AS ENUM (
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'CANCELLED'
);

CREATE TABLE "crawl_membership_analyses" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "crawl_id" UUID NOT NULL,
  "status" "CrawlMembershipStatus" NOT NULL,
  "scope_hash" CHAR(64) NOT NULL,
  "previous_crawl_id" UUID,
  "snapshot_count" INTEGER NOT NULL,
  "missing_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crawl_membership_analyses_pkey"
    PRIMARY KEY ("workspace_id", "project_id", "crawl_id"),
  CONSTRAINT "crawl_membership_analyses_scope_hash_check"
    CHECK ("scope_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "crawl_membership_analyses_counts_check"
    CHECK (
      "snapshot_count" BETWEEN 0 AND 1000 AND
      "missing_count" BETWEEN 0 AND 1000 AND
      (
        "status" = 'COMPLETED'
        OR (
          "previous_crawl_id" IS NULL AND
          "missing_count" = 0
        )
      ) AND
      (
        "missing_count" = 0
        OR "previous_crawl_id" IS NOT NULL
      )
    )
);

CREATE INDEX "crawl_membership_analyses_comparable_idx"
  ON "crawl_membership_analyses"(
    "workspace_id", "project_id", "status", "scope_hash",
    "created_at" DESC
  );

ALTER TABLE "crawl_membership_analyses"
  ADD CONSTRAINT "crawl_membership_analyses_previous_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "previous_crawl_id")
  REFERENCES "crawl_membership_analyses"(
    "workspace_id", "project_id", "crawl_id"
  )
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "crawl_page_absences" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "crawl_id" UUID NOT NULL,
  "page_id" UUID NOT NULL,
  "previous_crawl_id" UUID NOT NULL,
  "previous_snapshot_id" UUID NOT NULL,
  "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crawl_page_absences_pkey"
    PRIMARY KEY ("workspace_id", "project_id", "crawl_id", "page_id")
);

CREATE INDEX "crawl_page_absences_project_crawl_idx"
  ON "crawl_page_absences"(
    "workspace_id", "project_id", "crawl_id",
    "detected_at" DESC, "page_id"
  );

ALTER TABLE "crawl_page_absences"
  ADD CONSTRAINT "crawl_page_absences_analysis_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "crawl_id")
  REFERENCES "crawl_membership_analyses"(
    "workspace_id", "project_id", "crawl_id"
  )
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "crawl_page_absences"
  ADD CONSTRAINT "crawl_page_absences_previous_analysis_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "previous_crawl_id")
  REFERENCES "crawl_membership_analyses"(
    "workspace_id", "project_id", "crawl_id"
  )
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "crawl_page_absences"
  ADD CONSTRAINT "crawl_page_absences_page_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "page_id")
  REFERENCES "pages"("workspace_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "crawl_page_absences"
  ADD CONSTRAINT "crawl_page_absences_snapshot_tenant_fkey"
  FOREIGN KEY (
    "workspace_id", "project_id",
    "previous_crawl_id", "previous_snapshot_id"
  )
  REFERENCES "crawl_page_snapshots"(
    "workspace_id", "project_id", "crawl_id", "id"
  )
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER crawl_membership_analyses_immutable_trigger
  BEFORE UPDATE OR DELETE ON "crawl_membership_analyses"
  FOR EACH ROW EXECUTE FUNCTION reject_crawl_snapshot_mutation();

CREATE TRIGGER crawl_page_absences_immutable_trigger
  BEFORE UPDATE OR DELETE ON "crawl_page_absences"
  FOR EACH ROW EXECUTE FUNCTION reject_crawl_snapshot_mutation();
