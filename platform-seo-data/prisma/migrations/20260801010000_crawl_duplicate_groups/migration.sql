CREATE TYPE "CrawlDuplicateKind" AS ENUM (
  'CONTENT',
  'TITLE',
  'DESCRIPTION',
  'H1'
);

CREATE UNIQUE INDEX "crawl_page_snapshots_tenant_project_crawl_id_key"
  ON "crawl_page_snapshots"(
    "workspace_id", "project_id", "crawl_id", "id"
  );

CREATE TABLE "crawl_duplicate_analyses" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "crawl_id" UUID NOT NULL,
  "snapshot_count" INTEGER NOT NULL,
  "group_count" INTEGER NOT NULL,
  "issue_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crawl_duplicate_analyses_pkey"
    PRIMARY KEY ("workspace_id", "project_id", "crawl_id"),
  CONSTRAINT "crawl_duplicate_analyses_counts_check"
    CHECK (
      "snapshot_count" BETWEEN 0 AND 1000 AND
      "group_count" BETWEEN 0 AND 2000 AND
      "issue_count" BETWEEN 0 AND 4000
    )
);

CREATE INDEX "crawl_duplicate_analyses_project_created_idx"
  ON "crawl_duplicate_analyses"(
    "workspace_id", "project_id", "created_at" DESC
  );

CREATE TABLE "crawl_duplicate_groups" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "crawl_id" UUID NOT NULL,
  "kind" "CrawlDuplicateKind" NOT NULL,
  "signature_hash" CHAR(64) NOT NULL,
  "member_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crawl_duplicate_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crawl_duplicate_groups_signature_check"
    CHECK ("signature_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "crawl_duplicate_groups_member_count_check"
    CHECK ("member_count" BETWEEN 2 AND 1000)
);

CREATE UNIQUE INDEX "crawl_duplicate_groups_crawl_kind_signature_key"
  ON "crawl_duplicate_groups"("crawl_id", "kind", "signature_hash");
CREATE UNIQUE INDEX "crawl_duplicate_groups_tenant_project_crawl_id_key"
  ON "crawl_duplicate_groups"(
    "workspace_id", "project_id", "crawl_id", "id"
  );
CREATE INDEX "crawl_duplicate_groups_project_crawl_kind_idx"
  ON "crawl_duplicate_groups"(
    "workspace_id", "project_id", "crawl_id", "kind",
    "member_count" DESC, "id"
  );

ALTER TABLE "crawl_duplicate_groups"
  ADD CONSTRAINT "crawl_duplicate_groups_analysis_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "crawl_id")
  REFERENCES "crawl_duplicate_analyses"(
    "workspace_id", "project_id", "crawl_id"
  )
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "crawl_duplicate_group_members" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "crawl_id" UUID NOT NULL,
  "group_id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "page_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crawl_duplicate_group_members_pkey"
    PRIMARY KEY ("group_id", "snapshot_id")
);

CREATE UNIQUE INDEX "crawl_duplicate_group_members_group_page_key"
  ON "crawl_duplicate_group_members"("group_id", "page_id");
CREATE INDEX "crawl_duplicate_group_members_project_crawl_page_idx"
  ON "crawl_duplicate_group_members"(
    "workspace_id", "project_id", "crawl_id", "page_id"
  );

ALTER TABLE "crawl_duplicate_group_members"
  ADD CONSTRAINT "crawl_duplicate_group_members_group_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "crawl_id", "group_id")
  REFERENCES "crawl_duplicate_groups"(
    "workspace_id", "project_id", "crawl_id", "id"
  )
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "crawl_duplicate_group_members"
  ADD CONSTRAINT "crawl_duplicate_group_members_snapshot_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "crawl_id", "snapshot_id")
  REFERENCES "crawl_page_snapshots"(
    "workspace_id", "project_id", "crawl_id", "id"
  )
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "crawl_duplicate_group_members"
  ADD CONSTRAINT "crawl_duplicate_group_members_page_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "page_id")
  REFERENCES "pages"("workspace_id", "project_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TRIGGER crawl_duplicate_analyses_immutable_trigger
  BEFORE UPDATE OR DELETE ON "crawl_duplicate_analyses"
  FOR EACH ROW EXECUTE FUNCTION reject_crawl_snapshot_mutation();

CREATE TRIGGER crawl_duplicate_groups_immutable_trigger
  BEFORE UPDATE OR DELETE ON "crawl_duplicate_groups"
  FOR EACH ROW EXECUTE FUNCTION reject_crawl_snapshot_mutation();

CREATE TRIGGER crawl_duplicate_group_members_immutable_trigger
  BEFORE UPDATE OR DELETE ON "crawl_duplicate_group_members"
  FOR EACH ROW EXECUTE FUNCTION reject_crawl_snapshot_mutation();
