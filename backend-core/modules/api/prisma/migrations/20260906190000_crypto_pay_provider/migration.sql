-- Additive: historical YooKassa payments, orders, ledger and subscriptions remain intact.
ALTER TYPE "BillingPaymentProvider" ADD VALUE IF NOT EXISTS 'CRYPTO_PAY';
ALTER TABLE "billing_payments" ADD COLUMN "creation_started_at" TIMESTAMPTZ(6);
ALTER TABLE "billing_payments" ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;
