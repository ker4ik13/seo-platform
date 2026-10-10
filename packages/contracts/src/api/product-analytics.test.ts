import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  parseAnalyticsActivityBatch,
  parseAnalyticsOperations,
  parseAnalyticsOperationsQuery,
  parseAnalyticsReportQuery,
} from "./product-analytics.js";
test("operation report producers and consumers share a bounded exclusion contract", () => {
  const scope = { days: 7, excludeWorkspaceIds: [randomUUID()] };
  assert.deepEqual(parseAnalyticsOperationsQuery(scope), scope);
  for (const input of [
    { ...scope, includeInternal: true },
    { ...scope, excludeWorkspaceIds: ["invalid"] },
    { ...scope, excludeWorkspaceIds: Array(10_001).fill(randomUUID()) },
    { ...scope, days: 365 },
  ])
    assert.throws(() => parseAnalyticsOperationsQuery(input));
});
test("analytics batches reject identities, arbitrary properties, oversized and future time", () => {
  const now = Date.now(),
    batch = {
      version: 1,
      sessionId: randomUUID(),
      intervals: [
        {
          id: randomUUID(),
          startedAt: new Date(now - 60_000).toISOString(),
          durationMs: 30_000,
          section: "SEMANTICS",
        },
      ],
      events: [],
    };
  assert.equal(parseAnalyticsActivityBatch(batch, now).intervals.length, 1);
  for (const value of [
    { ...batch, userId: randomUUID() },
    {
      ...batch,
      events: [
        {
          id: randomUUID(),
          occurredAt: new Date(now).toISOString(),
          section: "OTHER",
          kind: "PAYMENT",
          count: 1,
          value: 0,
        },
      ],
    },
    { ...batch, intervals: [{ ...batch.intervals[0], durationMs: 61_000 }] },
    {
      ...batch,
      intervals: [
        {
          ...batch.intervals[0],
          startedAt: new Date(now + 6000).toISOString(),
        },
      ],
    },
  ])
    assert.throws(() => parseAnalyticsActivityBatch(value, now));
  assert.throws(() =>
    parseAnalyticsActivityBatch(
      { ...batch, intervals: [batch.intervals[0], batch.intervals[0]] },
      now,
    ),
  );
});
test("analytics distinguishes complete timing distributions and strict report consumers", () => {
  const row = {
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    kind: "API_TIMING",
    section: "RANKINGS",
    count: 2,
    value: 300,
    histogram: [0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  assert.equal(
    parseAnalyticsActivityBatch({
      version: 1,
      sessionId: randomUUID(),
      intervals: [],
      events: [row],
    }).events[0]?.count,
    2,
  );
  assert.throws(() =>
    parseAnalyticsActivityBatch({
      version: 1,
      sessionId: randomUUID(),
      intervals: [],
      events: [{ ...row, count: 3 }],
    }),
  );
  assert.deepEqual(parseAnalyticsReportQuery({}), {
    days: 30,
    includeInternal: false,
  });
  assert.throws(() => parseAnalyticsReportQuery({ days: 365 }));
  assert.throws(() => parseAnalyticsReportQuery({ days: [7, 30] }));
  assert.deepEqual(
    parseAnalyticsOperations({
      since: null,
      daily: [],
      types: [],
      providers: [],
      origins: [],
      errors: [],
    }).types,
    [],
  );
  assert.throws(() =>
    parseAnalyticsOperations({
      since: null,
      daily: [],
      types: [],
      providers: [],
      origins: [],
      errors: [],
      token: "secret",
    }),
  );
});
