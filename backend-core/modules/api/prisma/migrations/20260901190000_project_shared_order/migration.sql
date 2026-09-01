ALTER TABLE "projects"
ADD COLUMN "display_order" INTEGER NOT NULL DEFAULT 0;

WITH ordered_projects AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "workspace_id"
      ORDER BY "created_at" ASC, "id" ASC
    ) - 1 AS "display_order"
  FROM "projects"
)
UPDATE "projects" AS project
SET "display_order" = ordered_projects."display_order"::integer
FROM ordered_projects
WHERE project."id" = ordered_projects."id";

CREATE INDEX "projects_workspace_id_display_order_created_at_id_idx"
ON "projects"("workspace_id", "display_order", "created_at", "id");
