ALTER TABLE "crawl_page_snapshots"
  ADD COLUMN "etag" VARCHAR(1000),
  ADD COLUMN "last_modified" VARCHAR(128),
  ADD COLUMN "not_modified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reused_from_snapshot_id" UUID;

ALTER TABLE "crawl_page_snapshots"
  ADD CONSTRAINT "crawl_page_snapshots_http_validator_check" CHECK (
    (
      "etag" IS NULL
      OR (
        length("etag") BETWEEN 1 AND 1000
        AND "etag" ~ '^[ -~]+$'
      )
    )
    AND (
      "last_modified" IS NULL
      OR (
        length("last_modified") BETWEEN 1 AND 128
        AND "last_modified" ~ '^[ -~]+$'
      )
    )
  ),
  ADD CONSTRAINT "crawl_page_snapshots_reuse_check" CHECK (
    ("not_modified" AND "reused_from_snapshot_id" IS NOT NULL)
    OR
    (NOT "not_modified" AND "reused_from_snapshot_id" IS NULL)
  ),
  ADD CONSTRAINT "crawl_page_snapshots_reused_from_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "reused_from_snapshot_id")
    REFERENCES "crawl_page_snapshots"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT;

CREATE INDEX "crawl_page_snapshots_reused_from_idx"
  ON "crawl_page_snapshots"(
    "workspace_id",
    "project_id",
    "reused_from_snapshot_id"
  );
