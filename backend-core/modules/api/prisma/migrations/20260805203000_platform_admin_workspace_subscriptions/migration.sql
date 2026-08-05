BEGIN;

CREATE TABLE "platform_admin_command_receipts" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "actor_id" UUID NOT NULL,
  "action" VARCHAR(160) NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "response_snapshot" JSONB NOT NULL,
  "workspace_id" UUID,
  "resource_type" VARCHAR(100) NOT NULL,
  "resource_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_admin_command_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_admin_command_receipts_request_hash_check"
    CHECK (octet_length("request_hash") = 32)
);

CREATE UNIQUE INDEX "platform_admin_command_receipts_actor_action_key"
  ON "platform_admin_command_receipts"("actor_id", "action", "idempotency_key");

CREATE INDEX "platform_admin_command_receipts_workspace_id_created_at_idx"
  ON "platform_admin_command_receipts"("workspace_id", "created_at");

CREATE INDEX "platform_admin_command_receipts_resource_type_resource_id_created_at_idx"
  ON "platform_admin_command_receipts"("resource_type", "resource_id", "created_at");

CREATE FUNCTION "protect_platform_admin_command_receipt"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform admin command receipts are immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "platform_admin_command_receipts_protect_mutation"
  BEFORE UPDATE OR DELETE ON "platform_admin_command_receipts"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_platform_admin_command_receipt"();

CREATE FUNCTION "deny_platform_admin_command_receipt_truncate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform admin command receipts cannot be truncated'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "platform_admin_command_receipts_no_truncate"
  BEFORE TRUNCATE ON "platform_admin_command_receipts"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "deny_platform_admin_command_receipt_truncate"();

COMMIT;
