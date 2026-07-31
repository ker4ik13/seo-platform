BEGIN;

-- CreateEnum
CREATE TYPE "BillingPlanStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "BillingCatalogVersionStatus" AS ENUM ('PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "BillingSubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'PAUSED', 'CANCELLING', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BillingPaymentProvider" AS ENUM ('YOOKASSA', 'MANUAL');

-- CreateEnum
CREATE TYPE "BillingOrderKind" AS ENUM ('SUBSCRIPTION', 'TOP_UP');

-- CreateEnum
CREATE TYPE "BillingOrderStatus" AS ENUM ('PENDING', 'PROVIDER_PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BillingPaymentStatus" AS ENUM ('CREATING', 'PENDING', 'SUCCEEDED', 'CANCELED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED_RETRYABLE', 'FAILED_FINAL');

-- CreateEnum
CREATE TYPE "BillingPaymentMethodStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "BillingRefundStatus" AS ENUM ('CREATING', 'PENDING', 'SUCCEEDED', 'CANCELED', 'FAILED_RETRYABLE', 'FAILED_FINAL');

-- CreateEnum
CREATE TYPE "BillingLedgerAccountType" AS ENUM ('CUSTOMER_PREPAID_LIABILITY', 'PROMOTIONAL_LIABILITY', 'PAYMENT_CLEARING', 'PLATFORM_REVENUE', 'PROMOTIONAL_EXPENSE', 'PROVIDER_COST', 'REFUNDS', 'RESERVATION');

-- CreateEnum
CREATE TYPE "BillingLedgerTransactionType" AS ENUM ('TOP_UP', 'SUBSCRIPTION_PAYMENT', 'INCLUDED_CREDIT_GRANT', 'RESERVATION', 'CAPTURE', 'RELEASE', 'REFUND', 'MANUAL_ADJUSTMENT', 'PROMO_GRANT', 'PROMO_EXPIRATION');

-- CreateEnum
CREATE TYPE "BillingLedgerTransactionStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "BillingLedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "BillingWebhookInboxStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED_RETRYABLE', 'FAILED_FINAL');

-- CreateEnum
CREATE TYPE "BillingBuyerType" AS ENUM ('INDIVIDUAL', 'INDIVIDUAL_ENTREPRENEUR', 'LEGAL_ENTITY');

-- CreateEnum
CREATE TYPE "NpdReceiptRegistrationMode" AS ENUM ('MANUAL_MY_TAX');

-- CreateEnum
CREATE TYPE "NpdReceiptStatus" AS ENUM ('PENDING', 'AWAITING_MANUAL_REGISTRATION', 'REGISTERING', 'REGISTERED', 'DELIVERY_PENDING', 'DELIVERED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLATION_PENDING', 'CANCELLED', 'REPLACEMENT_REQUIRED');

-- CreateTable
CREATE TABLE "billing_plans" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" VARCHAR(32) NOT NULL,
    "status" "BillingPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "name_ru" VARCHAR(120) NOT NULL,
    "description_ru" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_plan_versions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "plan_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "BillingCatalogVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_to" TIMESTAMPTZ(6),
    "features" JSONB NOT NULL,
    "included_data_credits_minor" BIGINT NOT NULL DEFAULT 0,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "service_description" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_plan_prices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "plan_version_id" UUID NOT NULL,
    "period" "BillingPeriod" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_subscriptions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "status" "BillingSubscriptionStatus" NOT NULL,
    "period" "BillingPeriod" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "current_period_start" TIMESTAMPTZ(6) NOT NULL,
    "current_period_end" TIMESTAMPTZ(6) NOT NULL,
    "trial_end" TIMESTAMPTZ(6),
    "grace_end" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "provider" "BillingPaymentProvider",
    "external_subscription_id" VARCHAR(255),
    "default_payment_method_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_trial_claims" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "claimed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_trial_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_orders" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "kind" "BillingOrderKind" NOT NULL,
    "status" "BillingOrderStatus" NOT NULL DEFAULT 'PENDING',
    "plan_version_id" UUID,
    "period" "BillingPeriod",
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "service_description_snapshot" VARCHAR(255) NOT NULL,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "request_hash" BYTEA NOT NULL,
    "terms_version" VARCHAR(64) NOT NULL,
    "terms_accepted_at" TIMESTAMPTZ(6) NOT NULL,
    "save_payment_method" BOOLEAN NOT NULL DEFAULT false,
    "buyer_type" "BillingBuyerType" NOT NULL,
    "buyer_name_encrypted" TEXT,
    "buyer_inn_encrypted" TEXT,
    "delivery_email_encrypted" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "billing_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "BillingPaymentProvider" NOT NULL,
    "external_id" VARCHAR(255),
    "provider_idempotency_key" VARCHAR(64) NOT NULL,
    "status" "BillingPaymentStatus" NOT NULL DEFAULT 'CREATING',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "confirmation_url" TEXT,
    "payment_method_record_id" UUID,
    "payment_method_type" VARCHAR(64),
    "provider_object_hash" BYTEA,
    "provider_created_at" TIMESTAMPTZ(6),
    "verified_at" TIMESTAMPTZ(6),
    "succeeded_at" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "refunded_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(100),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payment_methods" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "provider" "BillingPaymentProvider" NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160),
    "status" "BillingPaymentMethodStatus" NOT NULL DEFAULT 'ACTIVE',
    "consented_at" TIMESTAMPTZ(6) NOT NULL,
    "disabled_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_refunds" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "external_id" VARCHAR(255),
    "provider_idempotency_key" VARCHAR(64) NOT NULL,
    "request_idempotency_key" VARCHAR(180) NOT NULL,
    "request_hash" BYTEA NOT NULL,
    "status" "BillingRefundStatus" NOT NULL DEFAULT 'CREATING',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "provider_object_hash" BYTEA,
    "succeeded_at" TIMESTAMPTZ(6),
    "failure_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_ledger_accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID,
    "type" "BillingLedgerAccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_ledger_transactions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" "BillingLedgerTransactionType" NOT NULL,
    "status" "BillingLedgerTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "business_reference" VARCHAR(255) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "metadata" JSONB NOT NULL,
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_ledger_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "BillingLedgerDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_webhook_inbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider" "BillingPaymentProvider" NOT NULL,
    "event_fingerprint" CHAR(64) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "object_type" VARCHAR(32) NOT NULL,
    "object_id" VARCHAR(255) NOT NULL,
    "payload_hash" BYTEA NOT NULL,
    "source_ip" INET,
    "status" "BillingWebhookInboxStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(100),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "npd_receipt_obligations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payment_id" UUID NOT NULL,
    "yookassa_payment_id" VARCHAR(255) NOT NULL,
    "workspace_id" UUID NOT NULL,
    "gross_amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "service_description_snapshot" VARCHAR(255) NOT NULL,
    "buyer_type" "BillingBuyerType" NOT NULL,
    "buyer_name_encrypted" TEXT,
    "buyer_inn_encrypted" TEXT,
    "delivery_email_encrypted" TEXT NOT NULL,
    "registration_mode" "NpdReceiptRegistrationMode" NOT NULL DEFAULT 'MANUAL_MY_TAX',
    "status" "NpdReceiptStatus" NOT NULL DEFAULT 'AWAITING_MANUAL_REGISTRATION',
    "official_receipt_id" VARCHAR(255),
    "official_receipt_url" TEXT,
    "registered_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
    "cancellation_reason" VARCHAR(500),
    "replacement_receipt_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "npd_receipt_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_code_key" ON "billing_plans"("code");

-- CreateIndex
CREATE INDEX "billing_plans_status_code_idx" ON "billing_plans"("status", "code");

-- CreateIndex
CREATE INDEX "billing_plan_versions_status_effective_from_effective_to_idx" ON "billing_plan_versions"("status", "effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "billing_plan_versions_plan_version_key" ON "billing_plan_versions"("plan_id", "version");

-- CreateIndex
CREATE INDEX "billing_plan_prices_currency_period_idx" ON "billing_plan_prices"("currency", "period");

-- CreateIndex
CREATE UNIQUE INDEX "billing_plan_prices_version_period_currency_key" ON "billing_plan_prices"("plan_version_id", "period", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscriptions_workspace_id_key" ON "billing_subscriptions"("workspace_id");

-- CreateIndex
CREATE INDEX "billing_subscriptions_status_current_period_end_idx" ON "billing_subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "billing_trial_claims_owner_user_id_key" ON "billing_trial_claims"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_trial_claims_workspace_id_key" ON "billing_trial_claims"("workspace_id");

-- CreateIndex
CREATE INDEX "billing_orders_workspace_id_created_at_idx" ON "billing_orders"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "billing_orders_status_created_at_idx" ON "billing_orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_orders_workspace_idempotency_key" ON "billing_orders"("workspace_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "billing_payments_workspace_id_created_at_idx" ON "billing_payments"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "billing_payments_status_updated_at_idx" ON "billing_payments"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_order_provider_key" ON "billing_payments"("order_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_provider_external_id_key" ON "billing_payments"("provider", "external_id");

-- CreateIndex
CREATE INDEX "billing_payment_methods_workspace_id_status_idx" ON "billing_payment_methods"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payment_methods_provider_external_id_key" ON "billing_payment_methods"("provider", "external_id");

-- CreateIndex
CREATE INDEX "billing_refunds_workspace_id_created_at_idx" ON "billing_refunds"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "billing_refunds_status_updated_at_idx" ON "billing_refunds"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_refunds_workspace_idempotency_key" ON "billing_refunds"("workspace_id", "request_idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "billing_refunds_payment_provider_idempotency_key" ON "billing_refunds"("payment_id", "provider_idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "billing_refunds_external_id_key" ON "billing_refunds"("external_id");

-- CreateIndex
CREATE INDEX "billing_ledger_accounts_type_currency_idx" ON "billing_ledger_accounts"("type", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "billing_ledger_accounts_workspace_type_currency_key" ON "billing_ledger_accounts"("workspace_id", "type", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "billing_ledger_transactions_business_reference_key" ON "billing_ledger_transactions"("business_reference");

-- CreateIndex
CREATE INDEX "billing_ledger_transactions_occurred_at_id_idx" ON "billing_ledger_transactions"("occurred_at", "id");

-- CreateIndex
CREATE INDEX "billing_ledger_entries_account_id_created_at_idx" ON "billing_ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_ledger_entries_transaction_account_direction_key" ON "billing_ledger_entries"("transaction_id", "account_id", "direction");

-- CreateIndex
CREATE INDEX "billing_webhook_inbox_status_updated_at_idx" ON "billing_webhook_inbox"("status", "updated_at");

-- CreateIndex
CREATE INDEX "billing_webhook_inbox_provider_object_id_received_at_idx" ON "billing_webhook_inbox"("provider", "object_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_webhook_inbox_provider_fingerprint_key" ON "billing_webhook_inbox"("provider", "event_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "npd_receipt_obligations_payment_id_key" ON "npd_receipt_obligations"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "npd_receipt_obligations_yookassa_payment_id_key" ON "npd_receipt_obligations"("yookassa_payment_id");

-- CreateIndex
CREATE INDEX "npd_receipt_obligations_status_created_at_idx" ON "npd_receipt_obligations"("status", "created_at");

-- CreateIndex
CREATE INDEX "npd_receipt_obligations_workspace_id_created_at_idx" ON "npd_receipt_obligations"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "billing_plan_versions" ADD CONSTRAINT "billing_plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_plan_prices" ADD CONSTRAINT "billing_plan_prices_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "billing_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "billing_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_default_payment_method_id_fkey" FOREIGN KEY ("default_payment_method_id") REFERENCES "billing_payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_trial_claims" ADD CONSTRAINT "billing_trial_claims_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_trial_claims" ADD CONSTRAINT "billing_trial_claims_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "billing_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_payment_method_record_id_fkey" FOREIGN KEY ("payment_method_record_id") REFERENCES "billing_payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payment_methods" ADD CONSTRAINT "billing_payment_methods_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_refunds" ADD CONSTRAINT "billing_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "billing_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_ledger_accounts" ADD CONSTRAINT "billing_ledger_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_ledger_transactions" ADD CONSTRAINT "billing_ledger_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "billing_ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "billing_ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "billing_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "npd_receipt_obligations" ADD CONSTRAINT "npd_receipt_obligations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "billing_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "npd_receipt_obligations" ADD CONSTRAINT "npd_receipt_obligations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "npd_receipt_obligations" ADD CONSTRAINT "npd_receipt_obligations_replacement_receipt_id_fkey" FOREIGN KEY ("replacement_receipt_id") REFERENCES "npd_receipt_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial invariants. Money is stored only as integer minor units in RUB
-- during the first commercial phase.
ALTER TABLE "billing_plan_versions"
  ADD CONSTRAINT "billing_plan_versions_trial_days_check"
  CHECK ("trial_days" >= 0),
  ADD CONSTRAINT "billing_plan_versions_included_credits_check"
  CHECK ("included_data_credits_minor" >= 0),
  ADD CONSTRAINT "billing_plan_versions_effective_period_check"
  CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");

ALTER TABLE "billing_plan_prices"
  ADD CONSTRAINT "billing_plan_prices_amount_check"
  CHECK ("amount_minor" >= 0),
  ADD CONSTRAINT "billing_plan_prices_currency_check"
  CHECK ("currency" = 'RUB');

ALTER TABLE "billing_subscriptions"
  ADD CONSTRAINT "billing_subscriptions_period_check"
  CHECK ("current_period_end" > "current_period_start"),
  ADD CONSTRAINT "billing_subscriptions_currency_check"
  CHECK ("currency" = 'RUB');

ALTER TABLE "billing_orders"
  ADD CONSTRAINT "billing_orders_amount_check"
  CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "billing_orders_currency_check"
  CHECK ("currency" = 'RUB'),
  ADD CONSTRAINT "billing_orders_kind_fields_check"
  CHECK (
    ("kind" = 'SUBSCRIPTION' AND "plan_version_id" IS NOT NULL AND "period" IS NOT NULL)
    OR
    ("kind" = 'TOP_UP' AND "plan_version_id" IS NULL AND "period" IS NULL)
  );

ALTER TABLE "billing_payments"
  ADD CONSTRAINT "billing_payments_amount_check"
  CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "billing_payments_refunded_amount_check"
  CHECK ("refunded_amount_minor" >= 0 AND "refunded_amount_minor" <= "amount_minor"),
  ADD CONSTRAINT "billing_payments_currency_check"
  CHECK ("currency" = 'RUB');

ALTER TABLE "billing_refunds"
  ADD CONSTRAINT "billing_refunds_amount_check"
  CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "billing_refunds_currency_check"
  CHECK ("currency" = 'RUB');

ALTER TABLE "billing_ledger_accounts"
  ADD CONSTRAINT "billing_ledger_accounts_currency_check"
  CHECK ("currency" = 'RUB');

ALTER TABLE "billing_ledger_entries"
  ADD CONSTRAINT "billing_ledger_entries_amount_check"
  CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "billing_ledger_entries_currency_check"
  CHECK ("currency" = 'RUB');

ALTER TABLE "npd_receipt_obligations"
  ADD CONSTRAINT "npd_receipt_obligations_amount_check"
  CHECK ("gross_amount_minor" > 0),
  ADD CONSTRAINT "npd_receipt_obligations_currency_check"
  CHECK ("currency" = 'RUB');

-- PostgreSQL NULL uniqueness does not protect platform-wide accounts, so
-- normalize NULL workspace IDs only inside this expression index.
CREATE UNIQUE INDEX "billing_ledger_accounts_effective_owner_type_currency_key"
  ON "billing_ledger_accounts" (
    COALESCE("workspace_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "type",
    "currency"
  );

CREATE OR REPLACE FUNCTION "billing_guard_ledger_entries"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "BillingLedgerTransactionStatus";
  account_currency CHAR(3);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'billing ledger entries are append-only'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "status"
    INTO STRICT parent_status
    FROM "billing_ledger_transactions"
   WHERE "id" = NEW."transaction_id"
     FOR UPDATE;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'entries can only be added to a draft ledger transaction'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "currency"
    INTO STRICT account_currency
    FROM "billing_ledger_accounts"
   WHERE "id" = NEW."account_id";
  IF account_currency <> NEW."currency" THEN
    RAISE EXCEPTION 'ledger entry currency must match its account'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "billing_ledger_entries_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "billing_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "billing_guard_ledger_entries"();

CREATE OR REPLACE FUNCTION "billing_post_ledger_transaction"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  debit_total BIGINT;
  credit_total BIGINT;
  entry_count BIGINT;
  currency_count BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'billing ledger transactions must be created as drafts'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing ledger transactions are append-only'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" <> 'DRAFT'
    OR NEW."status" <> 'POSTED'
    OR NEW."id" <> OLD."id"
    OR NEW."type" <> OLD."type"
    OR NEW."business_reference" <> OLD."business_reference"
    OR NEW."description" <> OLD."description"
    OR NEW."occurred_at" <> OLD."occurred_at"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."metadata" IS DISTINCT FROM OLD."metadata"
    OR NEW."reversal_of_id" IS DISTINCT FROM OLD."reversal_of_id"
    OR NEW."created_at" <> OLD."created_at"
  THEN
    RAISE EXCEPTION 'only DRAFT to POSTED transition is allowed for ledger transactions'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT
    COALESCE(SUM("amount_minor") FILTER (WHERE "direction" = 'DEBIT'), 0),
    COALESCE(SUM("amount_minor") FILTER (WHERE "direction" = 'CREDIT'), 0),
    COUNT(*),
    COUNT(DISTINCT "currency")
  INTO debit_total, credit_total, entry_count, currency_count
  FROM "billing_ledger_entries"
  WHERE "transaction_id" = NEW."id";

  IF entry_count < 2
    OR debit_total <= 0
    OR debit_total <> credit_total
    OR currency_count <> 1
  THEN
    RAISE EXCEPTION 'posted ledger transaction must contain balanced entries in one currency'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "billing_ledger_transactions_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "billing_ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION "billing_post_ledger_transaction"();

CREATE OR REPLACE FUNCTION "billing_reject_ledger_truncate"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'billing ledger tables cannot be truncated'
    USING ERRCODE = 'check_violation';
END
$$;

CREATE TRIGGER "billing_ledger_entries_no_truncate"
BEFORE TRUNCATE ON "billing_ledger_entries"
FOR EACH STATEMENT EXECUTE FUNCTION "billing_reject_ledger_truncate"();

CREATE TRIGGER "billing_ledger_transactions_no_truncate"
BEFORE TRUNCATE ON "billing_ledger_transactions"
FOR EACH STATEMENT EXECUTE FUNCTION "billing_reject_ledger_truncate"();

-- Published commercial catalog v1. IDs are deterministic so application,
-- website and checkout all resolve the same immutable versions.
INSERT INTO "billing_plans"
  ("id", "code", "status", "name_ru", "description_ru", "created_at", "updated_at")
VALUES
  ('019be4c0-0000-7000-8000-000000000001', 'TRIAL', 'ACTIVE', 'Trial', 'Проверка платформы с BYOK без списаний системных API.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000000002', 'SOLO', 'ACTIVE', 'Solo', 'Для самостоятельного SEO-специалиста и небольших сайтов.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000000003', 'TEAM', 'ACTIVE', 'Team', 'Для SEO-команды с совместной работой и клиентским доступом.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000000004', 'AGENCY', 'ACTIVE', 'Agency', 'Для агентств с множеством проектов, white label и приоритетом.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000000005', 'BUSINESS', 'ACTIVE', 'Business', 'Для крупных in-house команд и интенсивной эксплуатации.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000000006', 'ENTERPRISE', 'ACTIVE', 'Enterprise', 'Индивидуальные лимиты, договор, SLA и onboarding.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "billing_plan_versions"
  ("id", "plan_id", "version", "status", "effective_from", "features",
   "included_data_credits_minor", "trial_days", "service_description", "created_at")
VALUES
  (
    '019be4c0-0000-7000-8000-000000001001',
    '019be4c0-0000-7000-8000-000000000001',
    1, 'PUBLISHED', '2026-07-01T00:00:00Z',
    '{"seats":1,"projects":1,"storedKeywords":25000,"keywordsPerProject":25000,"trackedContextPairs":500,"storageBytes":536870912,"rawSerpRetentionDays":7,"scheduledAutomations":1,"guestReports":0,"byok":true,"publicApi":"SANDBOX","clientRole":false,"whiteLabel":false,"queuePriority":"TRIAL"}'::jsonb,
    0, 14, 'Доступ к облачной SEO-платформе — пробный период', CURRENT_TIMESTAMP
  ),
  (
    '019be4c0-0000-7000-8000-000000001002',
    '019be4c0-0000-7000-8000-000000000002',
    1, 'PUBLISHED', '2026-07-01T00:00:00Z',
    '{"seats":1,"projects":5,"storedKeywords":250000,"keywordsPerProject":250000,"trackedContextPairs":10000,"storageBytes":5368709120,"rawSerpRetentionDays":14,"scheduledAutomations":10,"guestReports":1,"byok":true,"publicApi":"BASIC","clientRole":false,"whiteLabel":false,"queuePriority":"NORMAL"}'::jsonb,
    10000, 0, 'Доступ к облачной SEO-платформе, тариф Solo', CURRENT_TIMESTAMP
  ),
  (
    '019be4c0-0000-7000-8000-000000001003',
    '019be4c0-0000-7000-8000-000000000003',
    1, 'PUBLISHED', '2026-07-01T00:00:00Z',
    '{"seats":5,"projects":25,"storedKeywords":2000000,"keywordsPerProject":2000000,"trackedContextPairs":50000,"storageBytes":32212254720,"rawSerpRetentionDays":30,"scheduledAutomations":100,"guestReports":20,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":false,"queuePriority":"NORMAL_PLUS"}'::jsonb,
    50000, 0, 'Доступ к облачной SEO-платформе, тариф Team', CURRENT_TIMESTAMP
  ),
  (
    '019be4c0-0000-7000-8000-000000001004',
    '019be4c0-0000-7000-8000-000000000004',
    1, 'PUBLISHED', '2026-07-01T00:00:00Z',
    '{"seats":15,"projects":75,"storedKeywords":10000000,"keywordsPerProject":5000000,"trackedContextPairs":250000,"storageBytes":107374182400,"rawSerpRetentionDays":90,"scheduledAutomations":500,"guestReports":200,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":true,"queuePriority":"HIGH"}'::jsonb,
    150000, 0, 'Доступ к облачной SEO-платформе, тариф Agency', CURRENT_TIMESTAMP
  ),
  (
    '019be4c0-0000-7000-8000-000000001005',
    '019be4c0-0000-7000-8000-000000000005',
    1, 'PUBLISHED', '2026-07-01T00:00:00Z',
    '{"seats":30,"projects":100,"storedKeywords":30000000,"keywordsPerProject":5000000,"trackedContextPairs":1000000,"storageBytes":322122547200,"rawSerpRetentionDays":180,"scheduledAutomations":2000,"guestReports":1000,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":true,"queuePriority":"HIGHEST_FAIR_USE"}'::jsonb,
    500000, 0, 'Доступ к облачной SEO-платформе, тариф Business', CURRENT_TIMESTAMP
  ),
  (
    '019be4c0-0000-7000-8000-000000001006',
    '019be4c0-0000-7000-8000-000000000006',
    1, 'PUBLISHED', '2026-07-01T00:00:00Z',
    '{"seats":50,"projects":250,"storedKeywords":100000000,"keywordsPerProject":5000000,"trackedContextPairs":3000000,"storageBytes":1099511627776,"rawSerpRetentionDays":365,"scheduledAutomations":5000,"guestReports":5000,"byok":true,"publicApi":"BASIC","clientRole":true,"whiteLabel":true,"queuePriority":"HIGHEST_FAIR_USE"}'::jsonb,
    1500000, 0, 'Доступ к облачной SEO-платформе, тариф Enterprise', CURRENT_TIMESTAMP
  );

INSERT INTO "billing_plan_prices"
  ("id", "plan_version_id", "period", "currency", "amount_minor", "created_at")
VALUES
  ('019be4c0-0000-7000-8000-000000002001', '019be4c0-0000-7000-8000-000000001001', 'MONTHLY', 'RUB', 0, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000002002', '019be4c0-0000-7000-8000-000000001002', 'MONTHLY', 'RUB', 149000, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000002003', '019be4c0-0000-7000-8000-000000001002', 'ANNUAL', 'RUB', 1519800, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000002004', '019be4c0-0000-7000-8000-000000001003', 'MONTHLY', 'RUB', 449000, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000002005', '019be4c0-0000-7000-8000-000000001003', 'ANNUAL', 'RUB', 4579800, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000002006', '019be4c0-0000-7000-8000-000000001004', 'MONTHLY', 'RUB', 1099000, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000002007', '019be4c0-0000-7000-8000-000000001004', 'ANNUAL', 'RUB', 11209800, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000002008', '019be4c0-0000-7000-8000-000000001005', 'MONTHLY', 'RUB', 2999000, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000002009', '019be4c0-0000-7000-8000-000000001005', 'ANNUAL', 'RUB', 30589800, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000002010', '019be4c0-0000-7000-8000-000000001006', 'MONTHLY', 'RUB', 6990000, CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000002011', '019be4c0-0000-7000-8000-000000001006', 'ANNUAL', 'RUB', 71298000, CURRENT_TIMESTAMP);

INSERT INTO "billing_ledger_accounts"
  ("id", "workspace_id", "type", "currency", "status", "created_at")
VALUES
  ('019be4c0-0000-7000-8000-000000003001', NULL, 'PAYMENT_CLEARING', 'RUB', 'ACTIVE', CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000003002', NULL, 'PLATFORM_REVENUE', 'RUB', 'ACTIVE', CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000003003', NULL, 'PROMOTIONAL_EXPENSE', 'RUB', 'ACTIVE', CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000003004', NULL, 'PROVIDER_COST', 'RUB', 'ACTIVE', CURRENT_TIMESTAMP),
  ('019be4c0-0000-7000-8000-000000003005', NULL, 'REFUNDS', 'RUB', 'ACTIVE', CURRENT_TIMESTAMP);

COMMIT;
