import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { proxyWorkerGateway } from "./worker-gateway-proxy.ts";

const id = "01900000-0000-7000-8000-000000000001";
const token = `Bearer wn_${"a".repeat(43)}`;

test("worker ingress forwards only one authenticated, bounded Gateway route", async () => {
  const originalFetch = globalThis.fetch;
  const originalFlag = process.env.WORKER_GATEWAY_ENABLED;
  const originalOrigin = process.env.WORKER_GATEWAY_INTERNAL_URL;
  process.env.WORKER_GATEWAY_ENABLED = "true";
  process.env.WORKER_GATEWAY_INTERNAL_URL = "http://backend-execution:4002";
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "http://backend-execution:4002/worker/v1/claim");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), token);
    assert.equal(headers.get("x-worker-id"), id);
    assert.equal(headers.get("cookie"), null);
    assert.equal(new TextDecoder().decode(init?.body as ArrayBuffer), "{}");
    return Response.json({ data: { work: [], ranks: [], cancelled: [] }, meta: {} }, { status: 201 });
  };
  try {
    const request = new NextRequest("https://seo.example.test/worker/v1/claim", {
      method: "POST", body: "{}", headers: { Authorization: token, "X-Worker-Id": id, "Content-Type": "application/json" }
    });
    const response = await proxyWorkerGateway(request, ["claim"]);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).data.work.length, 0);
    assert.equal(calls, 1);
    assert.equal((await proxyWorkerGateway(request, ["internal", "receipts"])).status, 404);
    assert.equal((await proxyWorkerGateway(new NextRequest("https://seo.example.test/worker/v1/claim", {
      method: "POST", body: "{}", headers: { "Content-Type": "application/json" }
    }), ["claim"])).status, 401);
    assert.equal((await proxyWorkerGateway(new NextRequest("https://seo.example.test/worker/v1/claim", {
      method: "POST", body: "{}", headers: { Authorization: token, "X-Worker-Id": id, "Content-Type": "application/json", Cookie: "seo_access=fixture" }
    }), ["claim"])).status, 403);
    assert.equal((await proxyWorkerGateway(new NextRequest("https://seo.example.test/worker/v1/claim", {
      method: "POST", body: "{}", headers: { Authorization: token, "X-Worker-Id": id, "Content-Type": "application/json", "Content-Length": String(9 * 1_048_576) }
    }), ["claim"])).status, 413);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFlag === undefined) delete process.env.WORKER_GATEWAY_ENABLED;
    else process.env.WORKER_GATEWAY_ENABLED = originalFlag;
    if (originalOrigin === undefined) delete process.env.WORKER_GATEWAY_INTERNAL_URL;
    else process.env.WORKER_GATEWAY_INTERNAL_URL = originalOrigin;
  }
});

test("worker ingress is unavailable when the Gateway flag is off", async () => {
  const original = process.env.WORKER_GATEWAY_ENABLED;
  process.env.WORKER_GATEWAY_ENABLED = "false";
  try {
    const request = new NextRequest("https://seo.example.test/worker/v1/heartbeat", {
      method: "POST", body: "{}", headers: { Authorization: token, "X-Worker-Id": id, "Content-Type": "application/json" }
    });
    assert.equal((await proxyWorkerGateway(request, ["heartbeat"])).status, 404);
  } finally {
    if (original === undefined) delete process.env.WORKER_GATEWAY_ENABLED;
    else process.env.WORKER_GATEWAY_ENABLED = original;
  }
});

test("worker ingress accepts only a bounded authenticated rank receipt batch", async () => {
  const previousFetch = globalThis.fetch;
  const previousFlag = process.env.WORKER_GATEWAY_ENABLED;
  const previousOrigin = process.env.WORKER_GATEWAY_INTERNAL_URL;
  process.env.WORKER_GATEWAY_ENABLED = "true";
  process.env.WORKER_GATEWAY_INTERNAL_URL = "http://backend-execution:4002";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://backend-execution:4002/worker/v1/rank/complete-batch");
    assert.equal(new Headers(init?.headers).get("authorization"), token);
    return Response.json({ data: [true], meta: {} });
  };
  try {
    const url = "https://seo.example.test/worker/v1/rank/complete-batch";
    const headers = { Authorization: token, "X-Worker-Id": id, "Content-Type": "application/json" };
    const request = new NextRequest(url, { method: "POST", body: "{}", headers });
    assert.deepEqual((await (await proxyWorkerGateway(request, ["rank", "complete-batch"])).json()).data, [true]);
    const oversized = new NextRequest(url, { method: "POST", body: "{}", headers: { ...headers, "Content-Length": String(1_048_577) } });
    assert.equal((await proxyWorkerGateway(oversized, ["rank", "complete-batch"])).status, 413);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousFlag === undefined) delete process.env.WORKER_GATEWAY_ENABLED;
    else process.env.WORKER_GATEWAY_ENABLED = previousFlag;
    if (previousOrigin === undefined) delete process.env.WORKER_GATEWAY_INTERNAL_URL;
    else process.env.WORKER_GATEWAY_INTERNAL_URL = previousOrigin;
  }
});
