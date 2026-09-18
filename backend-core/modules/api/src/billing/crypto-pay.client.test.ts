import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { CryptoPayClient, CryptoPayProviderError, normalizeCryptoPayInvoice, verifyCryptoPaySignature } from "./crypto-pay.client.js";
import { loadAppConfig } from "../config/app-config.js";

const token = "123456789:synthetic-crypto-token-for-unit-tests-only";
const orderId = "01900000-0000-7000-8000-000000000001";
const workspaceId = "01900000-0000-7000-8000-000000000002";
const invoice = () => ({ invoice_id: 1001, currency_type: "fiat", fiat: "RUB", amount: "100.00", status: "active", created_at: "2026-09-06T10:00:00Z", payload: JSON.stringify({ order_id: orderId, workspace_id: workspaceId }), bot_invoice_url: "https://t.me/CryptoBot?start=invoice-synthetic" });
const signature = (raw: Buffer) => createHmac("sha256", createHash("sha256").update(token).digest()).update(raw).digest("hex");

test("verifies the exact raw webhook body and rejects tampering, malformed signatures and stale events", () => {
  const raw = Buffer.from('{ "update_type":"invoice_paid", "payload":{"invoice_id":1001},"request_date":"' + new Date().toISOString() + '" }');
  assert.equal(verifyCryptoPaySignature(token, raw, signature(raw)), true);
  assert.equal(verifyCryptoPaySignature(token, Buffer.from(JSON.stringify(JSON.parse(raw.toString()))), signature(raw)), false);
  assert.equal(verifyCryptoPaySignature(token, raw, "xyz"), false);
  const client = new CryptoPayClient(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://test", CRYPTO_PAY_ENABLED: "true", CRYPTO_PAY_API_TOKEN: token, CRYPTO_PAY_API_BASE_URL: "https://testnet-pay.crypt.bot/api" }));
  assert.equal(client.verifyWebhook(raw, signature(raw)).invoiceId, "1001");
  const stale = Buffer.from(JSON.stringify({ update_type: "invoice_paid", payload: { invoice_id: 1001 }, request_date: "2000-01-01T00:00:00Z" }));
  assert.throws(() => client.verifyWebhook(stale, signature(stale)));
});
test("normalizes RUB invoices with exact tenant metadata and rejects unsafe redirects and amounts", () => {
  const normalized = normalizeCryptoPayInvoice(invoice(), true);
  assert.equal(normalized.metadata.order_id, orderId);
  assert.equal(normalized.status, "pending");
  assert.equal(normalized.test, true);
  for (const mutation of [{ fiat: "USD" }, { amount: "1e6" }, { amount: "-1" }, { amount: "100.001" }, { invoice_id: 1.2 }, { bot_invoice_url: "https://attacker.example/pay" }, { payload: JSON.stringify({ order_id: orderId, workspace_id: "foreign" }) }]) {
    assert.throws(() => normalizeCryptoPayInvoice({ ...invoice(), ...mutation }, false));
  }
  assert.throws(() => normalizeCryptoPayInvoice({ ...invoice(), status: "paid" }, true));
  assert.equal(normalizeCryptoPayInvoice({ ...invoice(), status: "paid", paid_at: "2026-09-06T11:00:00Z" }, false).status, "succeeded");
});
test("configuration is opt-in and restricts provider endpoints", () => {
  const config = loadAppConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://test" });
  assert.equal(new CryptoPayClient(config).isEnabled(), false);
  assert.throws(() => loadAppConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://test", CRYPTO_PAY_ENABLED: "true" }));
  assert.throws(() => loadAppConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://test", CRYPTO_PAY_API_BASE_URL: "http://169.254.169.254/api" }));
});
test("creates a fiat invoice and preserves the provider rejection code", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  let reject = false;
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return reject
      ? new Response(JSON.stringify({ ok: false, error: "PARAM_AMOUNT_INVALID" }), { status: 400 })
      : new Response(JSON.stringify({ ok: true, result: invoice() }), { status: 200 });
  };
  try {
    const client = new CryptoPayClient(loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      WEB_PUBLIC_URL: "https://app.example.test",
      CRYPTO_PAY_ENABLED: "true",
      CRYPTO_PAY_API_TOKEN: token,
      CRYPTO_PAY_API_BASE_URL: "https://testnet-pay.crypt.bot/api"
    }));
    const payment = await client.createPayment({
      idempotencyKey: "not-used-by-provider",
      amountMinor: 10_000,
      description: "Balance top-up",
      returnUrl: "https://app.example.test/app/settings/billing?checkout=return",
      orderId,
      workspaceId,
      savePaymentMethod: false
    });
    assert.equal(payment.confirmationUrl?.startsWith("https://t.me/"), true);
    assert.deepEqual(requests[0], {
      currency_type: "fiat",
      fiat: "RUB",
      amount: "100.00",
      description: "Balance top-up",
      expires_in: 3600,
      allow_anonymous: false,
      allow_comments: false,
      paid_btn_name: "callback",
      paid_btn_url: "https://app.example.test/app/settings/billing?checkout=return",
      payload: JSON.stringify({ order_id: orderId, workspace_id: workspaceId })
    });

    reject = true;
    await assert.rejects(
      () => client.createPayment({
        idempotencyKey: "not-used-by-provider",
        amountMinor: 10_000,
        description: "Balance top-up",
        returnUrl: "https://app.example.test/app/settings/billing?checkout=return",
        orderId,
        workspaceId,
        savePaymentMethod: false
      }),
      (error) => error instanceof CryptoPayProviderError &&
        error.code === "CRYPTO_PAY_PARAM_AMOUNT_INVALID" &&
        error.providerReason === "PARAM_AMOUNT_INVALID" &&
        error.httpStatus === 400
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
