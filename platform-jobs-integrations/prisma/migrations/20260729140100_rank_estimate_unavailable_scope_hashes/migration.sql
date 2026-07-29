BEGIN;

ALTER TABLE "rank_estimates"
  DROP CONSTRAINT "rank_estimates_scope_hash_availability";

ALTER TABLE "rank_estimates"
  ADD CONSTRAINT "rank_estimates_scope_hash_availability"
  CHECK (
    (
      "keyword_count" BETWEEN 0 AND 1000
      AND "semantic_scope_hash" IS NOT NULL
      AND "scope_hash" IS NOT NULL
      AND octet_length("semantic_scope_hash") = 32
      AND octet_length("scope_hash") = 32
    )
    OR
    (
      "keyword_count" BETWEEN 1 AND 1001
      AND "semantic_scope_hash" IS NULL
      AND "scope_hash" IS NULL
    )
  ) NOT VALID;

ALTER TABLE "rank_estimates"
  VALIDATE CONSTRAINT "rank_estimates_scope_hash_availability";

COMMIT;
