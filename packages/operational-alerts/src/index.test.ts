import assert from "node:assert/strict";
import { createServer as createNetServer } from "node:net";
import test from "node:test";
import {
  createOperationalAlertClient,
  startOperationalAlertServer
} from "./index.js";

const operationalToken = "a".repeat(64);

test("disabled alerts are a no-op and require no secrets", async () => {
  const reporter = createOperationalAlertClient(
    { TELEGRAM_ALERTS_ENABLED: "false" },
    "frontend",
    {
      fetch: async () => {
        throw new Error("disabled reporter must not send");
      }
    }
  );

  assert.equal(
    reporter.capture({
      source: "next-request",
      code: "REQUEST_HANDLER_FAILURE",
      severity: "ERROR"
    }),
    false
  );
  await reporter.flush();
});

test("client emits an exact redacted envelope and deduplicates it", async () => {
  const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
  const diagnostics: string[] = [];
  const reporter = createOperationalAlertClient(
    {
      TELEGRAM_ALERTS_ENABLED: "true",
      OPERATIONAL_ALERTS_INTERNAL_URL: "http://alerts.internal:4004",
      OPERATIONAL_ALERT_TOKEN: operationalToken
    },
    "backend-core",
    {
      now: () => 1_000,
      writeDiagnostic: (message) => diagnostics.push(message),
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          ...(init ? { init } : {})
        });
        return new Response(null, { status: 202 });
      }
    }
  );
  const alert = {
    source: "http",
    code: "CHILD_ERROR_LOG",
    severity: "ERROR",
    fingerprint: "0123456789abcdef"
  } as const;

  assert.equal(reporter.capture(alert), true);
  assert.equal(reporter.capture(alert), false);
  await reporter.flush();

  assert.equal(diagnostics.length, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "http://alerts.internal:4004/internal/alerts");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    version: 1,
    service: "backend-core",
    source: "http",
    code: "CHILD_ERROR_LOG",
    severity: "ERROR",
    fingerprint: "0123456789abcdef"
  });
  const request = requests[0];
  assert.ok(request);
  assert.equal(
    new Headers(request.init?.headers).get("authorization"),
    `Bearer ${operationalToken}`
  );
});

test("authenticated receiver sends only bounded metadata to Telegram", async (context) => {
  const port = await freePort();
  const telegramCalls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
  let delivered!: () => void;
  const delivery = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  const server = await startOperationalAlertServer(
    {
      NODE_ENV: "production",
      SERVICE_VERSION: "0.1.0",
      BIND_ADDRESS: "127.0.0.1",
      OPERATIONAL_ALERTS_PORT: String(port),
      OPERATIONAL_ALERT_TOKEN: operationalToken,
      TELEGRAM_ALERTS_ENABLED: "true",
      TELEGRAM_ALERT_BOT_TOKEN: `123456789:${"A".repeat(35)}`,
      TELEGRAM_ALERT_CHAT_ID: "-1001234567890",
      TELEGRAM_ALERT_ENVIRONMENT: "test"
    },
    {
      now: () => Date.parse("2026-08-27T12:00:00.000Z"),
      fetch: async (input, init) => {
        telegramCalls.push({
          url: String(input),
          ...(init ? { init } : {})
        });
        delivered();
        return new Response(null, { status: 200 });
      }
    }
  );
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const reporter = createOperationalAlertClient(
    {
      TELEGRAM_ALERTS_ENABLED: "true",
      OPERATIONAL_ALERTS_INTERNAL_URL: `http://127.0.0.1:${port}`,
      OPERATIONAL_ALERT_TOKEN: operationalToken
    },
    "frontend"
  );

  reporter.capture({
    source: "next-request",
    code: "REQUEST_HANDLER_FAILURE",
    severity: "ERROR",
    fingerprint: "fedcba9876543210"
  });
  await reporter.flush();
  await delivery;

  assert.equal(telegramCalls.length, 1);
  const body = JSON.parse(String(telegramCalls[0]?.init?.body)) as {
    readonly text: string;
  };
  assert.match(body.text, /Сервис: frontend/u);
  assert.match(body.text, /Источник: next-request/u);
  assert.match(body.text, /Код: REQUEST_HANDLER_FAILURE/u);
  assert.match(body.text, /Отпечаток: fedcba9876543210/u);
  assert.doesNotMatch(body.text, /authorization|cookie|payload|stack/iu);

  const rejected = await fetch(`http://127.0.0.1:${port}/internal/alerts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${operationalToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      version: 1,
      service: "frontend",
      source: "next-request",
      code: "REQUEST_HANDLER_FAILURE",
      severity: "ERROR",
      message: "secret raw stack"
    })
  });
  assert.equal(rejected.status, 400);
});

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}
