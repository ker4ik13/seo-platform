import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { cryptoPayRawBody, installCryptoPayRawBody } from "./crypto-pay-raw-body.js";

test("captures exact webhook bytes only on the Crypto Pay route and rejects oversized bodies", async () => {
  const app = Fastify();
  installCryptoPayRawBody(app);
  const path = "/api/v1/billing/providers/crypto-pay/webhook";
  app.post(path, async request => ({ bytes: cryptoPayRawBody(request)?.toString("utf8") }));
  app.post("/ordinary", async request => ({ captured: Boolean(cryptoPayRawBody(request)) }));
  try {
    const body = '{  "signed":true }';
    const response = await app.inject({ method: "POST", url: path, headers: { "content-type": "application/json" }, payload: body });
    assert.equal(response.statusCode, 200); assert.equal(response.json().bytes, body);
    assert.equal((await app.inject({ method: "POST", url: "/ordinary", payload: {} })).json().captured, false);
    const large = await app.inject({ method: "POST", url: path, headers: { "content-type": "application/json" }, payload: JSON.stringify({ data: "x".repeat(70_000) }) });
    assert.equal(large.statusCode, 413);
  } finally { await app.close(); }
});
