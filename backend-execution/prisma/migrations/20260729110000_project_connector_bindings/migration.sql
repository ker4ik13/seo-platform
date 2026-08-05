BEGIN;

-- Freeze the legacy table before checking the destructive migration
-- precondition. ACCESS SHARE from the check alone would still allow a
-- concurrent INSERT to commit before DROP TABLE.
LOCK TABLE "integration_bindings" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "integration_bindings") THEN
    RAISE EXCEPTION
      'project connector binding migration requires an empty pre-release integration_bindings table';
  END IF;
END
$$;

-- The pre-release table did not enforce a project, normalize routes or keep
-- an immutable idempotency receipt. An empty-table precondition is therefore
-- required; environments with rows need an explicit expand/backfill/contract
-- migration and must not delete data to make this migration pass.
DROP TABLE "integration_bindings";

CREATE TYPE "ProjectConnectorRouteSourceKind" AS ENUM (
  'WORKSPACE_CREDENTIAL'
);

CREATE TABLE "project_connector_bindings" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "capability" VARCHAR(100) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_connector_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_connector_bindings_capability_not_blank"
    CHECK (length(btrim("capability")) > 0),
  CONSTRAINT "project_connector_bindings_version_positive"
    CHECK ("version" > 0)
);

CREATE TABLE "project_connector_binding_create_receipts" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "binding_id" UUID NOT NULL,
  "response_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_connector_binding_create_receipts_pkey"
    PRIMARY KEY ("workspace_id", "project_id", "idempotency_key"),
  CONSTRAINT "project_connector_binding_receipts_idempotency_key_not_blank"
    CHECK (length(btrim("idempotency_key")) > 0),
  CONSTRAINT "project_connector_binding_receipts_request_hash_length"
    CHECK (octet_length("request_hash") = 32)
);

CREATE TABLE "project_connector_routes" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "binding_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "source_kind" "ProjectConnectorRouteSourceKind" NOT NULL,
  "credential_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_connector_routes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_connector_routes_position_zero"
    CHECK ("position" = 0)
);

CREATE UNIQUE INDEX
  "integration_credentials_workspace_id_id_key"
  ON "integration_credentials" ("workspace_id", "id");

CREATE UNIQUE INDEX
  "project_connector_bindings_tenant_project_capability_key"
  ON "project_connector_bindings"
  ("workspace_id", "project_id", "capability");

CREATE UNIQUE INDEX
  "project_connector_bindings_tenant_project_id_key"
  ON "project_connector_bindings"
  ("workspace_id", "project_id", "id");

CREATE INDEX
  "project_connector_bindings_tenant_project_created_idx"
  ON "project_connector_bindings"
  ("workspace_id", "project_id", "created_at", "id");

CREATE UNIQUE INDEX
  "project_connector_binding_receipts_tenant_project_binding_key"
  ON "project_connector_binding_create_receipts"
  ("workspace_id", "project_id", "binding_id");

CREATE UNIQUE INDEX
  "project_connector_routes_tenant_project_binding_position_key"
  ON "project_connector_routes"
  ("workspace_id", "project_id", "binding_id", "position");

CREATE INDEX
  "project_connector_routes_tenant_credential_idx"
  ON "project_connector_routes" ("workspace_id", "credential_id");

ALTER TABLE "project_connector_routes"
  ADD CONSTRAINT "project_connector_routes_binding_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "binding_id")
  REFERENCES "project_connector_bindings"
  ("workspace_id", "project_id", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE,
  ADD CONSTRAINT "project_connector_routes_credential_tenant_fkey"
  FOREIGN KEY ("workspace_id", "credential_id")
  REFERENCES "integration_credentials" ("workspace_id", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "project_connector_binding_create_receipts"
  ADD CONSTRAINT "project_connector_binding_receipts_binding_tenant_fkey"
  FOREIGN KEY ("workspace_id", "project_id", "binding_id")
  REFERENCES "project_connector_bindings"
  ("workspace_id", "project_id", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

COMMIT;
