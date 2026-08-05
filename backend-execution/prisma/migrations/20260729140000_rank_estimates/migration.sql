BEGIN;

CREATE TABLE "rank_estimates" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "tracking_context_id" UUID NOT NULL,
  "idempotency_scope" VARCHAR(180) NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "project_version" INTEGER NOT NULL,
  "project_domain_hash" BYTEA NOT NULL,
  "context_version" INTEGER NOT NULL,
  "configuration_version" INTEGER NOT NULL,
  "configuration_hash" BYTEA NOT NULL,
  "semantic_scope_hash" BYTEA,
  "scope_hash" BYTEA,
  "binding_id" UUID,
  "binding_version" INTEGER,
  "route_id" UUID,
  "credential_id" UUID,
  "credential_status" "CredentialStatus",
  "credential_version" INTEGER,
  "credential_material_version" INTEGER,
  "credential_deleted_at" TIMESTAMPTZ(6),
  "credential_validation_id" UUID,
  "credential_validation_version" INTEGER,
  "credential_validation_connector_version" VARCHAR(64),
  "credential_validation_finished_at" TIMESTAMPTZ(6),
  "credential_verified_at" TIMESTAMPTZ(6),
  "provider" VARCHAR(64) NOT NULL,
  "credential_mode" "CredentialMode" NOT NULL,
  "provider_policy_version" VARCHAR(64) NOT NULL,
  "keyword_count" INTEGER NOT NULL,
  "provider_task_count" INTEGER NOT NULL,
  "minimum_submit_request_count" INTEGER NOT NULL,
  "minimum_check_request_count" INTEGER NOT NULL,
  "minimum_get_request_count" INTEGER NOT NULL,
  "blockers" JSONB NOT NULL,
  "response_snapshot" JSONB NOT NULL,
  "calculated_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_estimates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rank_estimates_idempotency_scope_not_blank"
    CHECK (length(btrim("idempotency_scope")) > 0),
  CONSTRAINT "rank_estimates_idempotency_key_not_blank"
    CHECK (length(btrim("idempotency_key")) > 0),
  CONSTRAINT "rank_estimates_request_hash_length"
    CHECK (octet_length("request_hash") = 32),
  CONSTRAINT "rank_estimates_project_domain_hash_length"
    CHECK (octet_length("project_domain_hash") = 32),
  CONSTRAINT "rank_estimates_configuration_hash_length"
    CHECK (octet_length("configuration_hash") = 32),
  CONSTRAINT "rank_estimates_scope_hash_availability"
    CHECK (
      (
        "keyword_count" <= 1000
        AND "semantic_scope_hash" IS NOT NULL
        AND "scope_hash" IS NOT NULL
        AND octet_length("semantic_scope_hash") = 32
        AND octet_length("scope_hash") = 32
      )
      OR
      (
        "keyword_count" = 1001
        AND "semantic_scope_hash" IS NULL
        AND "scope_hash" IS NULL
      )
    ),
  CONSTRAINT "rank_estimates_positive_versions"
    CHECK (
      "project_version" > 0
      AND "context_version" > 0
      AND "configuration_version" > 0
      AND "configuration_version" <= "context_version"
      AND ("binding_version" IS NULL OR "binding_version" > 0)
      AND ("credential_version" IS NULL OR "credential_version" > 0)
      AND (
        "credential_validation_version" IS NULL
        OR "credential_validation_version" > 0
      )
      AND (
        "credential_material_version" IS NULL
        OR "credential_material_version" > 0
      )
    ),
  CONSTRAINT "rank_estimates_counts_bounded"
    CHECK (
      "keyword_count" >= 0
      -- 1001 is the bounded "at least 1001" sentinel returned by SEO Data.
      AND "keyword_count" <= 1001
      AND "provider_task_count" >= 0
      AND "provider_task_count" <= 4
      AND (
        (
          "keyword_count" <= 1000
          AND "provider_task_count" = (("keyword_count" + 249) / 250)
        )
        OR
        (
          "keyword_count" = 1001
          AND "provider_task_count" = 0
        )
      )
      AND "minimum_submit_request_count" = "provider_task_count"
      AND "minimum_check_request_count" = "provider_task_count"
      AND "minimum_get_request_count" = "provider_task_count"
    ),
  CONSTRAINT "rank_estimates_provider_route"
    CHECK (
      "provider" = 'ARSENKIN'
      AND "credential_mode" = 'BYOK_API_KEY'
    ),
  CONSTRAINT "rank_estimates_provider_policy_version_not_blank"
    CHECK (length(btrim("provider_policy_version")) > 0),
  CONSTRAINT "rank_estimates_blockers_array"
    CHECK (
      jsonb_typeof("blockers") = 'array'
      AND jsonb_array_length("blockers") BETWEEN 1 AND 64
    ),
  CONSTRAINT "rank_estimates_response_snapshot_object"
    CHECK (
      jsonb_typeof("response_snapshot") = 'object'
      AND pg_column_size("response_snapshot") <= 65536
    ),
  CONSTRAINT "rank_estimates_binding_snapshot_complete"
    CHECK (
      (
        "binding_id" IS NULL
        AND "binding_version" IS NULL
        AND "route_id" IS NULL
        AND "credential_id" IS NULL
        AND "credential_status" IS NULL
        AND "credential_version" IS NULL
        AND "credential_material_version" IS NULL
        AND "credential_deleted_at" IS NULL
        AND "credential_verified_at" IS NULL
      )
      OR
      (
        "binding_id" IS NOT NULL
        AND "binding_version" IS NOT NULL
        AND (
          (
            "route_id" IS NULL
            AND "credential_id" IS NULL
            AND "credential_status" IS NULL
            AND "credential_version" IS NULL
            AND "credential_material_version" IS NULL
            AND "credential_deleted_at" IS NULL
            AND "credential_verified_at" IS NULL
          )
          OR
          (
            "route_id" IS NOT NULL
            AND "credential_id" IS NOT NULL
            AND "credential_status" IS NOT NULL
            AND "credential_version" IS NOT NULL
            AND "credential_material_version" IS NOT NULL
          )
        )
      )
    ),
  CONSTRAINT "rank_estimates_validation_snapshot_complete"
    CHECK (
      (
        "credential_validation_id" IS NULL
        AND "credential_validation_version" IS NULL
        AND "credential_validation_connector_version" IS NULL
        AND "credential_validation_finished_at" IS NULL
      )
      OR
      (
        "credential_validation_id" IS NOT NULL
        AND "credential_validation_version" IS NOT NULL
        AND "credential_validation_connector_version" IS NOT NULL
        AND "credential_validation_finished_at" IS NOT NULL
        AND "credential_id" IS NOT NULL
        AND "credential_material_version" IS NOT NULL
        AND "credential_verified_at" IS NOT NULL
        AND "credential_validation_finished_at" = "credential_verified_at"
        AND length(btrim("credential_validation_connector_version")) > 0
      )
    ),
  CONSTRAINT "rank_estimates_exact_ttl"
    CHECK ("expires_at" = "calculated_at" + INTERVAL '5 minutes')
);

CREATE UNIQUE INDEX "rank_estimates_workspace_scope_idempotency_key"
  ON "rank_estimates"
  ("workspace_id", "idempotency_scope", "idempotency_key");

CREATE INDEX "rank_estimates_tenant_context_created_idx"
  ON "rank_estimates"
  ("workspace_id", "project_id", "tracking_context_id", "created_at");

CREATE INDEX "rank_estimates_expiry_idx"
  ON "rank_estimates" ("expires_at", "id");

COMMIT;
