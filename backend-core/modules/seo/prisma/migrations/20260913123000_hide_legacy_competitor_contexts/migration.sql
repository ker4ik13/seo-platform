UPDATE "tracking_contexts" AS "context"
SET "is_reusable" = false
WHERE "context"."is_reusable" = true
  AND EXISTS (
    SELECT 1
    FROM "rank_execution_manifests" AS "manifest"
    WHERE "manifest"."workspace_id" = "context"."workspace_id"
      AND "manifest"."project_id" = "context"."project_id"
      AND "manifest"."tracking_context_id" = "context"."id"
      AND "manifest"."execution" ->> 'purpose' = 'COMPETITOR_SERP'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "rank_execution_manifests" AS "manifest"
    WHERE "manifest"."workspace_id" = "context"."workspace_id"
      AND "manifest"."project_id" = "context"."project_id"
      AND "manifest"."tracking_context_id" = "context"."id"
      AND COALESCE("manifest"."execution" ->> 'purpose', 'POSITION_TRACKING') <> 'COMPETITOR_SERP'
  );
