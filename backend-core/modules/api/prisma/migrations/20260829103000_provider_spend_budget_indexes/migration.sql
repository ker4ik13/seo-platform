BEGIN;

CREATE INDEX "billing_usage_provider_captured_budget_idx"
  ON "billing_usage_reservations"("provider", "status", "captured_at");

CREATE INDEX "billing_usage_provider_reserved_budget_idx"
  ON "billing_usage_reservations"("provider", "status", "expires_at");

COMMIT;
