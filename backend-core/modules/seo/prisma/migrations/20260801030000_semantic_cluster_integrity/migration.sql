DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "clusters"
    WHERE length(btrim("name")) NOT BETWEEN 1 AND 255
      OR "version" <= 0
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce semantic cluster integrity: invalid legacy cluster exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "clusters"
    WHERE "status" = 'ACTIVE'
    GROUP BY "workspace_id", "project_id", lower("name")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce semantic cluster uniqueness: duplicate active names exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "keywords" AS keyword
    LEFT JOIN "clusters" AS cluster
      ON cluster."workspace_id" = keyword."workspace_id"
      AND cluster."project_id" = keyword."project_id"
      AND cluster."id" = keyword."cluster_id"
    WHERE keyword."cluster_id" IS NOT NULL
      AND cluster."id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot add tenant-safe keyword cluster FK: invalid cluster_id exists';
  END IF;
END
$$;

ALTER TABLE "clusters"
  ADD CONSTRAINT "clusters_tenant_project_id_key"
    UNIQUE ("workspace_id", "project_id", "id"),
  ADD CONSTRAINT "clusters_name_not_blank"
    CHECK (length(btrim("name")) BETWEEN 1 AND 255),
  ADD CONSTRAINT "clusters_version_positive"
    CHECK ("version" > 0);

CREATE UNIQUE INDEX "clusters_active_name_key"
ON "clusters" ("workspace_id", "project_id", lower("name"))
WHERE "status" = 'ACTIVE';

ALTER TABLE "keywords"
  ADD CONSTRAINT "keywords_cluster_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "cluster_id")
    REFERENCES "clusters" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
