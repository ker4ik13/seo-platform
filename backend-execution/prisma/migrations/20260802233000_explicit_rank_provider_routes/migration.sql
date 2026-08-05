ALTER TABLE "project_connector_routes"
  DROP CONSTRAINT "project_connector_routes_position_zero";

ALTER TABLE "project_connector_routes"
  ADD CONSTRAINT "project_connector_routes_position_bounded"
  CHECK ("position" BETWEEN 0 AND 7);

-- Keep position 0 as the project default. Additional verified provider routes
-- are only used when a rank launch explicitly selects that provider.
WITH "eligible_provider_routes" AS (
  SELECT DISTINCT ON (b."id", c."provider")
    b."workspace_id",
    b."project_id",
    b."id" AS "binding_id",
    c."id" AS "credential_id",
    c."provider"
  FROM "project_connector_bindings" b
  JOIN "integration_credentials" c
    ON c."workspace_id" = b."workspace_id"
  WHERE b."capability" = 'SERP_RANK_TRACKING'
    AND c."provider" IN ('ARSENKIN', 'XMLSTOCK')
    AND c."mode" = 'BYOK_API_KEY'
    AND c."status" = 'ACTIVE'
    AND c."deleted_at" IS NULL
    AND c."verified_at" IS NOT NULL
    AND c."capabilities" @> '["SERP_RANK_TRACKING"]'::jsonb
    AND NOT EXISTS (
      SELECT 1
      FROM "project_connector_routes" existing_route
      JOIN "integration_credentials" existing_credential
        ON existing_credential."workspace_id" = existing_route."workspace_id"
       AND existing_credential."id" = existing_route."credential_id"
      WHERE existing_route."workspace_id" = b."workspace_id"
        AND existing_route."project_id" = b."project_id"
        AND existing_route."binding_id" = b."id"
        AND existing_credential."provider" = c."provider"
    )
  ORDER BY
    b."id",
    c."provider",
    c."verified_at" DESC,
    c."updated_at" DESC,
    c."id" DESC
),
"numbered_provider_routes" AS (
  SELECT
    candidate.*,
    COALESCE((
      SELECT MAX(existing_route."position")
      FROM "project_connector_routes" existing_route
      WHERE existing_route."workspace_id" = candidate."workspace_id"
        AND existing_route."project_id" = candidate."project_id"
        AND existing_route."binding_id" = candidate."binding_id"
    ), -1) + (ROW_NUMBER() OVER (
      PARTITION BY candidate."workspace_id", candidate."project_id", candidate."binding_id"
      ORDER BY candidate."provider", candidate."credential_id"
    ))::integer AS "position"
  FROM "eligible_provider_routes" candidate
)
INSERT INTO "project_connector_routes" (
  "workspace_id",
  "project_id",
  "binding_id",
  "position",
  "source_kind",
  "credential_id",
  "updated_at"
)
SELECT
  candidate."workspace_id",
  candidate."project_id",
  candidate."binding_id",
  candidate."position",
  'WORKSPACE_CREDENTIAL',
  candidate."credential_id",
  CURRENT_TIMESTAMP
FROM "numbered_provider_routes" candidate
WHERE candidate."position" BETWEEN 1 AND 7;
