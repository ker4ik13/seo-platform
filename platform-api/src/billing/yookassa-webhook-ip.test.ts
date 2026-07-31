import assert from "node:assert/strict";
import test from "node:test";
import { isYookassaWebhookIp } from "./yookassa-webhook-ip.js";

test("accepts the documented YooKassa IPv4 and IPv6 networks", () => {
  for (const address of [
    "185.71.76.0",
    "185.71.76.31",
    "77.75.153.127",
    "77.75.156.11",
    "::ffff:77.75.156.35",
    "2a02:5180:ffff::1"
  ]) {
    assert.equal(isYookassaWebhookIp(address), true, address);
  }
});

test("rejects adjacent, private and malformed source addresses", () => {
  for (const address of [
    "185.71.76.32",
    "77.75.153.128",
    "77.75.156.12",
    "127.0.0.1",
    "2a02:517f:ffff::1",
    "not-an-ip"
  ]) {
    assert.equal(isYookassaWebhookIp(address), false, address);
  }
});
