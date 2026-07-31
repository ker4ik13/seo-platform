ALTER TABLE "clusters"
  ADD COLUMN "primary_page_id" UUID,
  ADD COLUMN "page_mapping_source" VARCHAR(16),
  ADD COLUMN "page_mapping_confidence" DOUBLE PRECISION,
  ADD COLUMN "page_mapping_rationale" TEXT;

ALTER TABLE "clusters"
  ADD CONSTRAINT "clusters_page_mapping_source_check"
    CHECK (
      "page_mapping_source" IS NULL
      OR "page_mapping_source" IN ('MANUAL', 'IMPORTED', 'RULE', 'AI', 'SERP')
    ),
  ADD CONSTRAINT "clusters_page_mapping_confidence_check"
    CHECK (
      "page_mapping_confidence" IS NULL
      OR "page_mapping_confidence" BETWEEN 0 AND 1
    ),
  ADD CONSTRAINT "clusters_page_mapping_consistency_check"
    CHECK (
      "primary_page_id" IS NOT NULL
      OR (
        "page_mapping_source" IS NULL
        AND "page_mapping_confidence" IS NULL
        AND "page_mapping_rationale" IS NULL
      )
    ),
  ADD CONSTRAINT "clusters_primary_page_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "primary_page_id")
    REFERENCES "pages" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "clusters_primary_page_idx"
  ON "clusters" (
    "workspace_id",
    "project_id",
    "primary_page_id",
    "status",
    "id"
  );
