ALTER TYPE "NpdReceiptRegistrationMode" ADD VALUE IF NOT EXISTS 'API_MY_TAX';
ALTER TABLE "npd_receipt_obligations"
  ADD COLUMN "issue_state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "issue_lease_token" UUID,
  ADD COLUMN "issue_lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "issue_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "issue_error_code" VARCHAR(64),
  ADD CONSTRAINT "npd_issue_state_check" CHECK (issue_state IN ('PENDING','CLAIMED','STARTED','UNKNOWN','FAILED','COMPLETED')),
  ADD CONSTRAINT "npd_issue_lease_check" CHECK ((issue_lease_token IS NULL) = (issue_lease_expires_at IS NULL));
CREATE INDEX "npd_issue_pending_idx" ON "npd_receipt_obligations" (issue_state, created_at) WHERE official_receipt_id IS NULL;
