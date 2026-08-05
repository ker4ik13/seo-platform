BEGIN;

LOCK TABLE "rank_estimates" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "rank_job_runs" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "rank_provider_request_intents" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "rank_estimates"
  DROP CONSTRAINT "rank_estimates_scope_hash_availability";

ALTER TABLE "rank_estimates"
  ADD CONSTRAINT "rank_estimates_scope_hash_availability"
  CHECK (
    (
      "provider_policy_version" = 'manual-arsenkin-positions@1.0.0'
      AND (
        (
          "keyword_count" BETWEEN 0 AND 1000
          AND "semantic_scope_hash" IS NOT NULL
          AND "scope_hash" IS NOT NULL
          AND octet_length("semantic_scope_hash") = 32
          AND octet_length("scope_hash") = 32
        )
        OR (
          "keyword_count" BETWEEN 1 AND 1001
          AND "semantic_scope_hash" IS NULL
          AND "scope_hash" IS NULL
        )
      )
    )
    OR (
      "provider_policy_version" = 'manual-arsenkin-positions@2.0.0'
      AND (
        (
          "keyword_count" BETWEEN 0 AND 15000
          AND "semantic_scope_hash" IS NOT NULL
          AND "scope_hash" IS NOT NULL
          AND octet_length("semantic_scope_hash") = 32
          AND octet_length("scope_hash") = 32
        )
        OR (
          "keyword_count" BETWEEN 1 AND 15001
          AND "semantic_scope_hash" IS NULL
          AND "scope_hash" IS NULL
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "rank_estimates"
  DROP CONSTRAINT "rank_estimates_counts_bounded";

ALTER TABLE "rank_estimates"
  ADD CONSTRAINT "rank_estimates_counts_bounded"
  CHECK (
    "keyword_count" >= 0
    AND "provider_task_count" >= 0
    AND "minimum_submit_request_count" = "provider_task_count"
    AND "minimum_check_request_count" = "provider_task_count"
    AND "minimum_get_request_count" = "provider_task_count"
    AND (
      (
        "provider_policy_version" = 'manual-arsenkin-positions@1.0.0'
        AND "keyword_count" <= 1001
        AND "provider_task_count" <= 4
        AND (
          (
            "keyword_count" <= 1000
            AND "provider_task_count" = (("keyword_count" + 249) / 250)
          )
          OR (
            "keyword_count" = 1001
            AND "provider_task_count" = 0
          )
        )
      )
      OR (
        "provider_policy_version" = 'manual-arsenkin-positions@2.0.0'
        AND "keyword_count" <= 15001
        AND "provider_task_count" <= 1
        AND (
          (
            "keyword_count" BETWEEN 1 AND 15000
            AND "provider_task_count" = 1
          )
          OR (
            "keyword_count" IN (0, 15001)
            AND "provider_task_count" = 0
          )
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "rank_job_runs"
  DROP CONSTRAINT "rank_job_runs_manifest_receipt";

ALTER TABLE "rank_job_runs"
  ADD CONSTRAINT "rank_job_runs_manifest_receipt"
  CHECK (
    (
      "seal_state" IN ('PENDING', 'OUTCOME_UNKNOWN', 'NOT_SEALED')
      AND "manifest_id" IS NULL
      AND "manifest_hash_schema" IS NULL
      AND "manifest_hash" IS NULL
      AND "manifest_deduplication_hash" IS NULL
      AND "manifest_pair_count" IS NULL
      AND "manifest_chunk_count" IS NULL
      AND "manifest_chunk_size" IS NULL
      AND "manifest_sealed_at" IS NULL
    )
    OR (
      "seal_state" IN ('SEALED', 'FINALIZED')
      AND "manifest_id" IS NOT NULL
      AND "manifest_hash_schema" = 'rank-manifest@1'
      AND "manifest_hash" IS NOT NULL
      AND octet_length("manifest_hash") = 32
      AND "manifest_deduplication_hash" IS NOT NULL
      AND octet_length("manifest_deduplication_hash") = 32
      AND "manifest_sealed_at" IS NOT NULL
      AND (
        (
          "manifest_pair_count" BETWEEN 1 AND 1000
          AND "manifest_chunk_size" = 250
          AND "manifest_chunk_count" =
            (("manifest_pair_count" + 249) / 250)
        )
        OR (
          "manifest_pair_count" BETWEEN 1 AND 15000
          AND "manifest_chunk_size" = 15000
          AND "manifest_chunk_count" = 1
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "rank_provider_request_intents"
  DROP CONSTRAINT "rank_provider_request_intents_shape";

ALTER TABLE "rank_provider_request_intents"
  ADD CONSTRAINT "rank_provider_request_intents_shape"
  CHECK (
    octet_length("manifest_hash") = 32
    AND "manifest_chunk_index" BETWEEN 0 AND 3
    AND octet_length("manifest_chunk_hash") = 32
    AND "schema_version" = 'rank-provider-request-intent@1'
    AND jsonb_typeof("request_snapshot") = 'object'
    AND octet_length("request_snapshot"::text) <= 67108864
    AND octet_length("request_hash") = 32
  ) NOT VALID;

ALTER TABLE "rank_estimates"
  VALIDATE CONSTRAINT "rank_estimates_scope_hash_availability";
ALTER TABLE "rank_estimates"
  VALIDATE CONSTRAINT "rank_estimates_counts_bounded";
ALTER TABLE "rank_job_runs"
  VALIDATE CONSTRAINT "rank_job_runs_manifest_receipt";
ALTER TABLE "rank_provider_request_intents"
  VALIDATE CONSTRAINT "rank_provider_request_intents_shape";

COMMIT;
