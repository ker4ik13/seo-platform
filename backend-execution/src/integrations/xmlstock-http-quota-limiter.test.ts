import assert from "node:assert/strict";
import test from "node:test";
import {
  XMLSTOCK_HTTP_QUOTA_POLICIES,
  acquireXmlStockHttpQuotaPermit,
  penalizeXmlStockHttpQuota,
  recordXmlStockHttpQuotaSuccess,
  releaseXmlStockHttpQuotaPermit,
  xmlStockHttpQuotaKey,
  xmlStockQuotaShouldWait
} from "./xmlstock-http-quota-limiter.js";

test("an explicit Wordstat batch waits across rolling RPS windows without unbounded polling", () => {
  assert.equal(xmlStockQuotaShouldWait(850,100,4_000,true),true);
  assert.equal(xmlStockQuotaShouldWait(850,3_500,4_000,true),false);
  assert.equal(xmlStockQuotaShouldWait(850,100,4_000,false),false);
  assert.equal(xmlStockQuotaShouldWait(250,100,500,false),true);
});

const firstCredential = "01900000-0000-7000-8000-000000000001";
const secondCredential = "01900000-0000-7000-8000-000000000002";
const firstWorkspace = "01900000-0000-7000-8000-000000000011";
const secondWorkspace = "01900000-0000-7000-8000-000000000012";
const firstMember = "01900000-0000-7000-8000-000000000003";
const secondMember = "01900000-0000-7000-8000-000000000004";

test("uses the documented XMLStock product windows", () => {
  assert.deepEqual(XMLSTOCK_HTTP_QUOTA_POLICIES, {
    YANDEX_LIVE: { concurrency: 10, requestsPerSecond: 10 },
    YANDEX_TURBO: { concurrency: 50, requestsPerSecond: 50 },
    GOOGLE_LIVE: { concurrency: 15, requestsPerSecond: 30 },
    YANDEX_SEARCH_API: { concurrency: 50, requestsPerSecond: 50 },
    WORDSTAT: { concurrency: 10, requestsPerSecond: 10 }
  });
});

test("quota keys isolate credentials and XMLStock products", () => {
  assert.notEqual(
    xmlStockHttpQuotaKey(firstCredential, "YANDEX_LIVE"),
    xmlStockHttpQuotaKey(secondCredential, "YANDEX_LIVE")
  );
  assert.notEqual(
    xmlStockHttpQuotaKey(firstCredential, "YANDEX_LIVE"),
    xmlStockHttpQuotaKey(firstCredential, "GOOGLE_LIVE")
  );
  assert.equal(
    xmlStockHttpQuotaKey(firstCredential.toUpperCase(), "WORDSTAT"),
    `${xmlStockHttpQuotaKey(firstCredential, "WORDSTAT")}`
  );
});

test("acquires from only the selected credential and product bucket", async () => {
  const calls: unknown[][] = [];
  const permit = await acquireXmlStockHttpQuotaPermit(
    {
      eval: async (...args: unknown[]) => {
        calls.push(args);
        return [1, 0, 8, 8];
      }
    } as never,
    {
      credentialId: firstCredential,
      workspaceId: firstWorkspace,
      product: "YANDEX_LIVE",
      leaseMs: 13_000,
      member: firstMember,
      globalConcurrency: 64
    }
  );

  assert.deepEqual(permit, {
    allowed: true,
    credentialId: firstCredential,
    workspaceId: firstWorkspace,
    product: "YANDEX_LIVE",
    member: firstMember
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[1], 9);
  assert.equal(
    calls[0]?.[2],
    `${xmlStockHttpQuotaKey(firstCredential, "YANDEX_LIVE")}:inflight`
  );
  assert.equal(
    calls[0]?.[3],
    `${xmlStockHttpQuotaKey(firstCredential, "YANDEX_LIVE")}:rps`
  );
  assert.equal(calls[0]?.[8], "seo-platform:jobs:v1:provider-rate-limit:xmlstock:global:inflight");
  assert.equal(calls[0]?.[9], "seo-platform:jobs:v1:provider-rate-limit:xmlstock:global:waiters");
  assert.equal(calls[0]?.[10], `${xmlStockHttpQuotaKey(firstCredential, "YANDEX_LIVE")}:workspace-waiters`);
  assert.equal(calls[0]?.[16], "64");
  assert.equal(calls[0]?.[17], firstCredential);
  assert.equal(calls[0]?.[18], firstWorkspace);
});

test("returns a bounded retry without issuing a permit when a bucket is full", async () => {
  const permit = await acquireXmlStockHttpQuotaPermit(
    { eval: async () => [0, 1_250, 4, 4] } as never,
    {
      credentialId: secondCredential,
      workspaceId: secondWorkspace,
      product: "WORDSTAT",
      requestCost: 3,
      leaseMs: 35_000,
      member: secondMember
    }
  );

  assert.deepEqual(permit, {
    allowed: false,
    retryAfterSeconds: 2,
    retryAfterMilliseconds: 1_250
  });
});

test("remote node has its own HTTP ceiling while keeping the physical key bucket", async () => {
  const calls: unknown[][] = [];
  const permit = await acquireXmlStockHttpQuotaPermit(
    { eval: async (...args: unknown[]) => {
      calls.push(args);
      return [1, 0, 10, 10];
    } } as never,
    {
      credentialId: firstCredential,
      workspaceId: firstWorkspace,
      product: "YANDEX_LIVE",
      leaseMs: 13_000,
      member: firstMember,
      nodeId: secondCredential,
      globalConcurrency: 24
    }
  );
  assert.equal(calls[0]?.[2], `${xmlStockHttpQuotaKey(firstCredential, "YANDEX_LIVE")}:inflight`);
  assert.equal(calls[0]?.[8], `seo-platform:jobs:v1:provider-rate-limit:xmlstock:node:${secondCredential}:inflight`);
  assert.equal(calls[0]?.[16], "24");
  assert.equal(permit.allowed, true);
  if (!permit.allowed) return;
  assert.equal(permit.nodeId, secondCredential);
  const releaseCalls: unknown[][] = [];
  await releaseXmlStockHttpQuotaPermit({ eval: async (...args: unknown[]) => {
    releaseCalls.push(args);
    return 1;
  } } as never, permit);
  assert.equal(releaseCalls[0]?.[3], `seo-platform:jobs:v1:provider-rate-limit:xmlstock:node:${secondCredential}:inflight`);
});

test("release, penalty and recovery mutate only the same bucket", async () => {
  const calls: unknown[][] = [];
  const redis = {
    eval: async (...args: unknown[]) => {
      calls.push(args);
      if (args[1] === 2) return 1;
      if (args[1] === 3) return [1, 5_000];
      return 0;
    }
  } as never;

  await releaseXmlStockHttpQuotaPermit(redis, {
    allowed: true,
    credentialId: firstCredential,
    workspaceId: firstWorkspace,
    product: "GOOGLE_LIVE",
    member: firstMember
  });
  await penalizeXmlStockHttpQuota(redis, {
    credentialId: firstCredential,
    product: "GOOGLE_LIVE",
    retryAfterSeconds: 5
  });
  await recordXmlStockHttpQuotaSuccess(redis, {
    credentialId: firstCredential,
    product: "GOOGLE_LIVE"
  });

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.match(
      String(call[2]),
      new RegExp(
        `^${xmlStockHttpQuotaKey(firstCredential, "GOOGLE_LIVE")}`,
        "u"
      )
    );
  }
  assert.equal(calls[0]?.[3], "seo-platform:jobs:v1:provider-rate-limit:xmlstock:global:inflight");
  assert.equal(calls[0]?.[5], firstCredential);
  assert.equal(calls[0]?.[6], firstWorkspace);
});
