BEGIN;

-- Zero is the canonical value for an unlimited capacity entitlement. The
-- original snapshot constraint predated unlimited plans and rejected a valid
-- immutable snapshot while confirming an import. Replacing the constraint is
-- metadata-only and does not rewrite or remove import data.
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
        AND "stored_keywords_limit" >= 0
        AND "keywords_per_project_limit" >= 0
        AND "folders_per_project_limit" >= 0
        AND "tracked_context_pairs_limit" >= 0
      )
    ) NOT VALID;

ALTER TABLE "semantic_imports"
  VALIDATE CONSTRAINT "semantic_imports_entitlement_completeness_check";

COMMIT;
