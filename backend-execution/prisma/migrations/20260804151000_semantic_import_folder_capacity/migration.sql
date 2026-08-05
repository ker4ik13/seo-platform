ALTER TABLE "semantic_imports"
  ADD COLUMN "folders_per_project_limit" BIGINT;

-- Confirmed imports from before this rollout already carry all other
-- entitlement fields. Keep them publishable during a rolling restart without
-- inventing a restrictive folder limit.
UPDATE "semantic_imports"
SET "folders_per_project_limit" = 9007199254740991
WHERE "billing_plan_code" IS NOT NULL
  AND "folders_per_project_limit" IS NULL;

ALTER TABLE "semantic_imports"
  DROP CONSTRAINT "semantic_imports_entitlement_completeness_check";

ALTER TABLE "semantic_imports"
  ADD CONSTRAINT "semantic_imports_entitlement_completeness_check"
    CHECK (
      (
        "billing_plan_code" IS NULL
        AND "billing_plan_version" IS NULL
        AND "stored_keywords_limit" IS NULL
        AND "keywords_per_project_limit" IS NULL
        AND "folders_per_project_limit" IS NULL
        AND "tracked_context_pairs_limit" IS NULL
      )
      OR
      (
        "billing_plan_code" ~ '^[A-Z][A-Z0-9_-]{0,63}$'
        AND "billing_plan_version" > 0
        AND "stored_keywords_limit" > 0
        AND "keywords_per_project_limit" > 0
        AND "folders_per_project_limit" >= 0
        AND "tracked_context_pairs_limit" > 0
      )
    );
