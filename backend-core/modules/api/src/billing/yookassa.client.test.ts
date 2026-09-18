import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import {
  parseYookassaPayment,
  parseYookassaRefund,
  YookassaClient,
  YookassaProviderError,
  yookassaMoneyMinor
} from "./yookassa.client.js";

const paymentFixture = {
  id: "2f45f8d0-000f-5000-8000-1c3a1f1c9e10",
  status: "pending",
  paid: false,
  amount: { value: "1990.00", currency: "RUB" },
  created_at: "2026-07-30T10:20:30.000Z",
  confirmation: {
    type: "redirect",
    confirmation_url: "https://yoomoney.ru/checkout/payments/v2/contract"
  },
  metadata: { order_id: "order-1", workspace_id: "workspace-1" },
  payment_method: {
    id: "2f45f8d0-000f-5000-8000-1c3a1f1c9e11",
    type: "bank_card",
    saved: true,
    title: "Bank card *4444"
  },
  test: true
};

test("parses a strict YooKassa payment and refund projection", () => {
  const payment = parseYookassaPayment(paymentFixture);
  assert.equal(payment.amount.value, "1990.00");
  assert.equal(payment.confirmationUrl?.startsWith("https://"), true);
  assert.equal(payment.paymentMethod?.saved, true);
  assert.equal(payment.objectHash.length, 32);

  const refund = parseYookassaRefund({
    id: "refund-1",
    payment_id: payment.id,
    status: "succeeded",
    amount: { value: "100.50", currency: "RUB" },
    created_at: "2026-07-30T10:25:30.000Z",
    metadata: { refund_id: "local-refund-1" }
  });
  assert.equal(refund.paymentId, payment.id);
  assert.equal(yookassaMoneyMinor(refund.amount), 10_050);
});

test("rejects non-RUB money and unsafe redirect confirmations", () => {
  assert.throws(
    () => yookassaMoneyMinor({ value: "1.00", currency: "USD" }),
    YookassaProviderError
  );
  assert.throws(
    () =>
      parseYookassaPayment({
        ...paymentFixture,
        confirmation: {
          type: "redirect",
          confirmation_url: "http://attacker.invalid/payment"
        }
      }),
    YookassaProviderError
  );
});

test("sends Basic auth and Idempotence-Key only to the configured API", async () => {
  const originalFetch = globalThis.fetch;
  let request:
    | { readonly url: string; readonly init: RequestInit }
    | undefined;
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    request = {
      url: String(input),
      init: init ?? {}
    };
    return new Response(JSON.stringify(paymentFixture), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const client = new YookassaClient(
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        YOOKASSA_ENABLED: "true",
        YOOKASSA_SHOP_ID: "123456",
        YOOKASSA_SECRET_KEY: "s".repeat(32),
        YOOKASSA_RETURN_URL: "https://app.example.test/billing/return",
        YOOKASSA_API_BASE_URL: "http://provider.test/v3"
      })
    );
    await client.createPayment({
      idempotencyKey: "12345678abcdefgh",
      amountMinor: 199_000,
      description: "Team subscription",
      returnUrl: "https://app.example.test/billing/return",
      orderId: "order-1",
      workspaceId: "workspace-1",
      savePaymentMethod: false
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(request);
  assert.equal(request.url, "http://provider.test/v3/payments");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.redirect, "error");
  const headers = new Headers(request.init.headers);
  assert.equal(
    headers.get("authorization"),
    `Basic ${Buffer.from(`${"123456"}:${"s".repeat(32)}`).toString("base64")}`
  );
  assert.equal(headers.get("idempotence-key"), "12345678abcdefgh");
  assert.doesNotMatch(String(request.init.body), /secret|123456:/u);
  assert.equal(
    Object.hasOwn(
      JSON.parse(String(request.init.body)) as Record<string, unknown>,
      "save_payment_method"
    ),
    false
  );
});

test("retries transient network failures with the same idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  const idempotencyKeys: string[] = [];
  let attempts = 0;
  globalThis.fetch = async (
    _input: string | URL | Request,
    init?: RequestInit
  ) => {
    attempts += 1;
    idempotencyKeys.push(
      new Headers(init?.headers).get("idempotence-key") ?? ""
    );
    if (attempts < 3) throw new TypeError("temporary network failure");
    return new Response(JSON.stringify(paymentFixture), { status: 200 });
  };

  try {
    const client = new YookassaClient(
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        YOOKASSA_ENABLED: "true",
        YOOKASSA_SHOP_ID: "123456",
        YOOKASSA_SECRET_KEY: "s".repeat(32),
        YOOKASSA_RETURN_URL: "https://app.example.test/billing/return",
        YOOKASSA_API_BASE_URL: "http://provider.test/v3"
      })
    );
    await client.createPayment({
      idempotencyKey: "networkretry1234",
      amountMinor: 199_000,
      description: "Team subscription",
      returnUrl: "https://app.example.test/billing/return",
      orderId: "order-1",
      workspaceId: "workspace-1",
      savePaymentMethod: true
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(attempts, 3);
  assert.deepEqual(idempotencyKeys, [
    "networkretry1234",
    "networkretry1234",
    "networkretry1234"
  ]);
});

test("preserves a safe YooKassa error parameter for operational diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    type: "error",
    id: "provider-request-id",
    code: "invalid_request",
    description: "must never be exposed verbatim",
    parameter: "confirmation.return_url"
  }), { status: 400 });
  try {
    const client = new YookassaClient(loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      YOOKASSA_ENABLED: "true",
      YOOKASSA_SHOP_ID: "123456",
      YOOKASSA_SECRET_KEY: "s".repeat(32),
      YOOKASSA_RETURN_URL: "https://app.example.test/billing/return",
      YOOKASSA_API_BASE_URL: "http://provider.test/v3"
    }));
    await assert.rejects(
      () => client.createPayment({
        idempotencyKey: "providererror123",
        amountMinor: 10_000,
        description: "Balance top-up",
        returnUrl: "https://app.example.test/billing/return",
        orderId: "order-1",
        workspaceId: "workspace-1",
        savePaymentMethod: false
      }),
      (error) => error instanceof YookassaProviderError &&
        error.code === "YOOKASSA_INVALID_REQUEST" &&
        error.httpStatus === 400 &&
        error.parameter === "confirmation.return_url" &&
        !error.message.includes("must never")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("charges a consented saved method without creating a hosted redirect", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = async (
    _input: string | URL | Request,
    init?: RequestInit
  ) => {
    requestBody = JSON.parse(String(init?.body)) as unknown;
    return new Response(
      JSON.stringify({
        ...paymentFixture,
        confirmation: undefined,
        payment_method: {
          ...paymentFixture.payment_method,
          id: "saved-method-1"
        }
      }),
      { status: 200 }
    );
  };

  try {
    const client = new YookassaClient(
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        YOOKASSA_ENABLED: "true",
        YOOKASSA_SHOP_ID: "123456",
        YOOKASSA_SECRET_KEY: "s".repeat(32),
        YOOKASSA_RETURN_URL: "https://app.example.test/billing/return",
        YOOKASSA_API_BASE_URL: "http://provider.test/v3"
      })
    );
    await client.createPayment({
      idempotencyKey: "renewal12345678",
      amountMinor: 449_000,
      description: "Team renewal",
      paymentMethodId: "saved-method-1",
      orderId: "renewal-order-1",
      workspaceId: "workspace-1",
      savePaymentMethod: false
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requestBody, {
    amount: { value: "4490.00", currency: "RUB" },
    capture: true,
    payment_method_id: "saved-method-1",
    description: "Team renewal",
    metadata: {
      order_id: "renewal-order-1",
      workspace_id: "workspace-1"
    }
  });
});
