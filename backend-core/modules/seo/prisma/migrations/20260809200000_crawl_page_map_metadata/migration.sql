ALTER TABLE "pages"
ADD COLUMN "included_in_map" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "crawl_page_snapshots"
ADD COLUMN "meta_tags" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX "pages_project_map_updated_idx"
ON "pages"("workspace_id", "project_id", "included_in_map", "status", "updated_at" DESC, "id" DESC);
