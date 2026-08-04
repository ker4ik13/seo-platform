import assert from "node:assert/strict";
import test from "node:test";
import type { Redis } from "ioredis";
import {
  acquireArsenkinHttpRateLimitPermit,
  ARSENKIN_HTTP_RATE_LIMIT,
  ARSENKIN_HTTP_RATE_LIMIT_KEY,
  ARSENKIN_HTTP_RATE_WINDOW_MS
} from "./arsenkin-http-rate-limiter.js";

const member = "01900000-0000-7000-8000-000000000001";

test("uses one exact Redis rolling window for all Arsenkin HTTP requests", async () => {
  const calls: unknown[][] = [];
  const redis = {
    async eval(...args: unknown[]) {
      calls.push(args);
      return [1, 0];
    }
  } as unknown as Pick<Redis, "eval">;

  assert.deepEqual(
    await acquireArsenkinHttpRateLimitPermit(redis, member),
    { allowed: true }
  );
  assert.equal(calls.length, 1);
  const [script, keyCount, key, limit, windowMs, receivedMember] =
    calls[0] ?? [];
  assert.equal(keyCount, 1);
  assert.equal(key, ARSENKIN_HTTP_RATE_LIMIT_KEY);
  assert.equal(limit, String(ARSENKIN_HTTP_RATE_LIMIT));
  assert.equal(windowMs, String(ARSENKIN_HTTP_RATE_WINDOW_MS));
  assert.equal(receivedMember, member);
  assert.match(String(script), /redis\.call\('TIME'\)/u);
  assert.match(String(script), /ZREMRANGEBYSCORE/u);
  assert.match(String(script), /ZCARD/u);
  assert.match(String(script), /ZRANGE/u);
  assert.match(String(script), /ZADD/u);
  assert.match(String(script), /PEXPIRE/u);
});

test("fails closed with a bounded retry delay when the rolling window is full", async () => {
  const redis = {
    async eval() {
      return [0, 1_501];
    }
  } as unknown as Pick<Redis, "eval">;

  assert.deepEqual(
    await acquireArsenkinHttpRateLimitPermit(redis, member),
    { allowed: false, retryAfterSeconds: 2 }
  );
});

test("rejects malformed Redis output and limiter member IDs", async () => {
  const redis = {
    async eval() {
      return ["1", 0];
    }
  } as unknown as Pick<Redis, "eval">;

  await assert.rejects(
    acquireArsenkinHttpRateLimitPermit(redis, member),
    /Invalid Arsenkin rate limiter response/u
  );
  await assert.rejects(
    acquireArsenkinHttpRateLimitPermit(redis, "not-a-uuid"),
    /Invalid Arsenkin rate limit member/u
  );
});
