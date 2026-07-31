ALTER TABLE "semantic_imports"
  ADD COLUMN "billing_plan_code" VARCHAR(64),
  ADD COLUMN "billing_plan_version" INTEGER,
  ADD COLUMN "stored_keywords_limit" BIGINT,
  ADD COLUMN "keywords_per_project_limit" BIGINT,
  ADD COLUMN "tracked_context_pairs_limit" BIGINT;

ALTER TABLE "semantic_imports"
  ADD CONSTRAINT "semantic_imports_entitlement_completeness_check"
    CHECK (
      (
        "billing_plan_code" IS NULL
        AND "billing_plan_version" IS NULL
        AND "stored_keywords_limit" IS NULL
        AND "keywords_per_project_limit" IS NULL
        AND "tracked_context_pairs_limit" IS NULL
      )
      OR
      (
        "billing_plan_code" ~ '^[A-Z][A-Z0-9_-]{0,63}$'
        AND "billing_plan_version" > 0
        AND "stored_keywords_limit" > 0
        AND "keywords_per_project_limit" > 0
        AND "tracked_context_pairs_limit" > 0
      )
    );
