ALTER TABLE "clusters"
  ADD COLUMN "is_locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "exclude_from_reclustering" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX CONCURRENTLY "clusters_reclustering_eligibility_idx"
  ON "clusters" (
    "workspace_id",
    "project_id",
    "status",
    "is_locked",
    "exclude_from_reclustering",
    "id"
  );
