CREATE TABLE "tracking_context_keyword_replace_receipts" (
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "idempotency_key" varchar(180) NOT NULL,
  "request_hash" bytea NOT NULL,
  "context_id" uuid NOT NULL,
  "response_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_context_keyword_replace_receipts_pkey"
    PRIMARY KEY ("workspace_id", "project_id", "actor_id", "idempotency_key"),
  CONSTRAINT "tracking_context_keyword_replace_receipts_context_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "context_id")
    REFERENCES "tracking_contexts" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "tracking_context_keyword_replace_receipts_context_idx"
  ON "tracking_context_keyword_replace_receipts" ("workspace_id", "project_id", "context_id");
