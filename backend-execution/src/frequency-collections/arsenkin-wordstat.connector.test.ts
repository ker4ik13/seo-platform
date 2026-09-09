import assert from "node:assert/strict";
import test from "node:test";
import type { ArsenkinHttpRateLimitGate } from "../integrations/arsenkin-http-rate-limiter.js";
import {
  ArsenkinWordstatConnector,
  arsenkinSeasonalityBatchValues,
  arsenkinSeasonalityRequest,
  arsenkinWordstatBatchValues,
  arsenkinWordstatRequest
} from "./arsenkin-wordstat.connector.js";

const monthlySeasonality = {
  granularity: "MONTH" as const,
  observedFrom: "2026-01-01",
  observedThrough: "2026-03-31"
};

test("builds the documented Arsenkin Wordstat frequency request", () => {
  assert.deepEqual(
    arsenkinWordstatRequest({
      keywords: ["  ремонт   киа ", "seo аудит"],
      types: ["BASE", "EXACT", "FIXED"],
      regionCode: "213",
      device: "ALL"
    }),
    {
      tools_name: "wordstat",
      data: {
        type: 1,
        queries: ["ремонт киа", "seo аудит"],
        device: "",
        regions: [213],
        ws: ["base", "quoted", "overal"]
      }
    }
  );
});

test("builds the documented Arsenkin seasonality request", () => {
  assert.deepEqual(
    arsenkinSeasonalityRequest({
      keywords: ["  ремонт   киа ", "seo аудит"],
      regionCode: "213",
      device: "PHONE_ONLY",
      seasonality: monthlySeasonality
    }),
    {
      tools_name: "wordstat",
      data: {
        type: 3,
        queries: ["ремонт киа", "seo аудит"],
        device: "phone",
        region: 213,
        group: "month",
        startdate: "2026-01-01",
        enddate: "2026-03-31",
        correct_dates: true
      }
    }
  );
});

test("normalizes a bounded Arsenkin seasonality result", () => {
  assert.deepEqual(
    arsenkinSeasonalityBatchValues(
      seasonalityResult({
        "seo аудит": {
          "213": [
            { date: "2026-01-01", count: 50 },
            { date: "2026-02-01", count: "80" },
            { date: "2026-03-01", count: 40 }
          ]
        },
        "ремонт киа": {
          "213": {
            "2026-01": 1200,
            "2026-02": { value: "1500", share: "0.15" },
            "2026-03": 900
          }
        }
      }),
      "42",
      ["ремонт киа", "seo аудит"],
      monthlySeasonality,
      "213"
    ),
    [
      {
        query: "ремонт киа",
        points: [
          { periodStart: "2026-01-01", value: "1200" },
          { periodStart: "2026-02-01", value: "1500", share: "0.15" },
          { periodStart: "2026-03-01", value: "900" }
        ]
      },
      {
        query: "seo аудит",
        points: [
          { periodStart: "2026-01-01", value: "50" },
          { periodStart: "2026-02-01", value: "80" },
          { periodStart: "2026-03-01", value: "40" }
        ]
      }
    ]
  );
});

test("normalizes the observed Arsenkin type-3 array response", () => {
  assert.deepEqual(
    arsenkinSeasonalityBatchValues(
      {
        code: "TASK_RESULT",
        task_id: 42,
        result: {
          type: 3,
          task_id: "42",
          data: [{
            query: "ремонт киа",
            data: {
              "2026-01-01": { frequency: 1200 },
              "2026-02-01": { frequency: 1500 },
              "2026-03-01": { frequency: 900 }
            }
          }],
          dates: ["2026-01-01", "2026-02-01", "2026-03-01"]
        },
        created_at: "2026-09-09 08:25:28",
        finished_at: "2026-09-09 08:25:50"
      },
      "42",
      ["ремонт киа"],
      monthlySeasonality,
      "213"
    ),
    [{
      query: "ремонт киа",
      points: [
        { periodStart: "2026-01-01", value: "1200" },
        { periodStart: "2026-02-01", value: "1500" },
        { periodStart: "2026-03-01", value: "900" }
      ]
    }]
  );
});

test("recovers a large sparse Arsenkin seasonality payload without losing paid rows", () => {
  assert.deepEqual(
    arsenkinSeasonalityBatchValues(
      {
        code: "TASK_RESULT",
        task_id: 42,
        result: {
          type: "3",
          data: {
            "0": {
              query: "ремонт киа",
              data: {
                "2026-01-01": { frequency: 1200 },
                "2026-03-01": { frequency: 900 }
              }
            },
            "2": {
              query: "seo аудит",
              data: {}
            }
          },
          dates: ["2026-01-01", "2026-02-01", "2026-03-01"]
        }
      },
      "42",
      ["ремонт киа", "пропущенная строка", "seo аудит"],
      monthlySeasonality,
      "213"
    ),
    [
      {
        query: "ремонт киа",
        points: [
          { periodStart: "2026-01-01", value: "1200" },
          { periodStart: "2026-02-01", value: "0" },
          { periodStart: "2026-03-01", value: "900" }
        ]
      },
      {
        query: "пропущенная строка",
        points: [
          { periodStart: "2026-01-01", value: "0" },
          { periodStart: "2026-02-01", value: "0" },
          { periodStart: "2026-03-01", value: "0" }
        ]
      },
      {
        query: "seo аудит",
        points: [
          { periodStart: "2026-01-01", value: "0" },
          { periodStart: "2026-02-01", value: "0" },
          { periodStart: "2026-03-01", value: "0" }
        ]
      }
    ]
  );
});

test("normalizes the production-sized 3,066-key sparse seasonality result", () => {
  const keywords = Array.from(
    { length: 3_066 },
    (_, index) => `морозильный ларь запрос ${index + 1}`
  );
  const dates = Array.from({ length: 24 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 8 + index, 1));
    return date.toISOString().slice(0, 10);
  });
  const data = Object.fromEntries(
    keywords.flatMap((query, index) =>
      index % 97 === 0
        ? []
        : [[String(index), {
            query,
            data: index % 13 === 0
              ? {}
              : { [dates.at(-1)!]: { frequency: index + 1 } }
          }]]
    )
  );
  const result = arsenkinSeasonalityBatchValues(
    {
      code: "TASK_RESULT",
      task_id: 42,
      result: { type: 3, task_id: 42, data, dates },
      finished_at: "2026-09-09 08:25:50"
    },
    "42",
    keywords,
    {
      granularity: "MONTH",
      observedFrom: "2024-09-01",
      observedThrough: "2026-08-31"
    },
    "225"
  );

  assert.equal(result?.length, 3_066);
  assert.ok(result?.every(({ points }) => points.length === 24));
  assert.ok(result?.every(({ points }) => points[0]?.value === "0"));
  assert.equal(result?.[0]?.points.at(-1)?.value, "0");
  assert.equal(result?.[1]?.points.at(-1)?.value, "2");
});

test("accepts a query-keyed seasonality payload but rejects corrupt non-empty rows", () => {
  const base = {
    code: "TASK_RESULT",
    task_id: "42",
    finished_at: "2026-09-09 08:25:50",
    result: {
      type: 3,
      task_id: 42,
      dates: ["2026-01-01", "2026-02-01", "2026-03-01"]
    }
  };
  assert.deepEqual(
    arsenkinSeasonalityBatchValues(
      {
        ...base,
        result: {
          ...base.result,
          data: {
            "ремонт киа": {
              "2026-01-01": { frequency: 10 },
              "2026-02-01": { frequency: 20 },
              "2026-03-01": { frequency: 30 }
            }
          }
        }
      },
      "42",
      ["ремонт киа"],
      monthlySeasonality,
      "213"
    )?.[0]?.points.map(({ value }) => value),
    ["10", "20", "30"]
  );
  assert.equal(
    arsenkinSeasonalityBatchValues(
      {
        ...base,
        result: {
          ...base.result,
          data: [{ query: "ремонт киа", data: { invalid: "payload" } }]
        }
      },
      "42",
      ["ремонт киа"],
      monthlySeasonality,
      "213"
    ),
    undefined
  );
});

test("rejects mismatched or duplicate Arsenkin seasonality periods", () => {
  assert.equal(
    arsenkinSeasonalityBatchValues(
      seasonalityResult({
        "ремонт киа": { "225": [{ date: "2026-01-01", value: 1 }] }
      }),
      "42",
      ["ремонт киа"],
      monthlySeasonality,
      "213"
    ),
    undefined
  );
  assert.equal(
    arsenkinSeasonalityBatchValues(
      seasonalityResult({
        "ремонт киа": {
          "213": [
            { date: "2026-01-01", value: 1 },
            { date: "2026-01-01", value: 2 }
          ]
        }
      }),
      "42",
      ["ремонт киа"],
      monthlySeasonality,
      "213"
    ),
    undefined
  );
});

test("keeps only requested full periods after Arsenkin corrects its live boundary", () => {
  const result = seasonalityResult({
    "ремонт киа": {
      "213": [
        { date: "2026-01-01", value: 10 },
        { date: "2026-02-01", value: 20 },
        { date: "2026-03-01", value: 30 },
        { date: "2026-04-01", value: 40 }
      ]
    }
  });
  (result as { result: { data: { enddate: string } } }).result.data.enddate =
    "2026-04-06";
  assert.deepEqual(
    arsenkinSeasonalityBatchValues(
      result,
      "42",
      ["ремонт киа"],
      monthlySeasonality,
      "213"
    )?.[0]?.points.map(({ periodStart }) => periodStart),
    ["2026-01-01", "2026-02-01", "2026-03-01"]
  );
});

test("submits and fetches one Arsenkin seasonality task", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const connector = new ArsenkinWordstatConnector(allowAll(), async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    if (path.endsWith("/set")) return jsonResponse({ task_id: 42 });
    if (path.endsWith("/check")) {
      return jsonResponse({ code: "TASK_STATUS", status: "finish", progress: 100 });
    }
    return jsonResponse(seasonalityResult({
      "ремонт киа": { "213": [{ date: "2026-01-01", value: 1200 }] }
    }));
  });
  assert.deepEqual(
    await connector.submitSeasonality(
      {
        keywords: ["ремонт киа"],
        regionCode: "213",
        device: "ALL",
        seasonality: monthlySeasonality
      },
      { apiKey: "private-key" },
      1_000
    ),
    { status: "ACCEPTED", taskId: "42" }
  );
  assert.deepEqual(
    await connector.fetchSeasonalityResult(
      "42",
      ["ремонт киа"],
      monthlySeasonality,
      "213",
      { apiKey: "private-key" },
      1_000
    ),
    {
      status: "READY",
      results: [{
        query: "ремонт киа",
        points: [{ periodStart: "2026-01-01", value: "1200" }]
      }]
    }
  );
  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/tools/set",
    "/api/tools/check",
    "/api/tools/get"
  ]);
});

test("accepts exactly 10,000 Wordstat queries and rejects 10,001", () => {
  const request = arsenkinWordstatRequest({
    keywords: Array.from({ length: 10_000 }, (_, index) => `query ${index + 1}`),
    types: ["BASE"],
    regionCode: "213",
    device: "ALL"
  });
  assert.equal(request.data.queries.length, 10_000);
  assert.throws(
    () => arsenkinWordstatRequest({
      keywords: Array.from({ length: 10_001 }, (_, index) => `query ${index + 1}`),
      types: ["BASE"],
      regionCode: "213",
      device: "ALL"
    }),
    /query batch/u
  );
});

test("submits one provider task for the entire platform Wordstat batch", async () => {
  const calls: unknown[] = [];
  let permits = 0;
  const connector = new ArsenkinWordstatConnector({
    async tryAcquire() {
      permits += 1;
      return { allowed: true };
    }
  }, async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ task_id: 42 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });
  assert.deepEqual(
    await connector.submit(
      {
        keywords: ["ремонт киа", "seo аудит", "ремонт киа"],
        types: ["BASE"],
        regionCode: "213",
        device: "ALL"
      },
      { apiKey: "private-key" },
      1_000
    ),
    { status: "ACCEPTED", taskId: "42" }
  );
  assert.equal(calls.length, 1);
  assert.equal(permits, 1);
  assert.deepEqual(calls[0], {
    tools_name: "wordstat",
    data: {
      type: 1,
      queries: ["ремонт киа", "seo аудит"],
      device: "",
      regions: [213],
      ws: ["base"]
    }
  });
});

test("runs the durable submit guard after the permit and before provider HTTP", async () => {
  const order: string[] = [];
  const connector = new ArsenkinWordstatConnector({
    async tryAcquire() {
      order.push("permit");
      return { allowed: true };
    }
  }, async () => {
    order.push("http");
    return jsonResponse({ task_id: 42 });
  });
  assert.deepEqual(
    await connector.submit(
      {
        keywords: ["seo аудит"],
        types: ["BASE"],
        regionCode: "213",
        device: "ALL"
      },
      { apiKey: "private-key" },
      1_000,
      async () => {
        order.push("durable-marker");
        return true;
      }
    ),
    { status: "ACCEPTED", taskId: "42" }
  );
  assert.deepEqual(order, ["permit", "durable-marker", "http"]);
});

test("does not call provider HTTP when the shared provider slot is full", async () => {
  let calls = 0;
  const connector = new ArsenkinWordstatConnector(allowAll(), async () => {
    calls += 1;
    return jsonResponse({ task_id: 42 });
  });
  assert.deepEqual(
    await connector.submit(
      {
        keywords: ["seo аудит"],
        types: ["BASE"],
        regionCode: "213",
        device: "ALL"
      },
      { apiKey: "private-key" },
      1_000,
      async () => false
    ),
    {
      status: "RETRYABLE_FAILURE",
      code: "PROVIDER_CONCURRENCY_LIMITED",
      retryAfterSeconds: 5
    }
  );
  assert.equal(calls, 0);
});

test("normalizes the live Wordstat result schema and keeps requested query order", () => {
  assert.deepEqual(
    arsenkinWordstatBatchValues(
      liveResult({
        "seo аудит": { base: 50, quoted: 20, overal: 5 },
        "ремонт киа": { base: 1200, quoted: 340, overal: 90 }
      }),
      "42",
      ["ремонт киа", "seo аудит"],
      ["BASE", "EXACT", "FIXED"],
      "213"
    ),
    [
      {
        query: "ремонт киа",
        values: { BASE: "1200", EXACT: "340", FIXED: "90" }
      },
      {
        query: "seo аудит",
        values: { BASE: "50", EXACT: "20", FIXED: "5" }
      }
    ]
  );
});

test("checks provider status and does not call get while Wordstat is processing", async () => {
  const paths: string[] = [];
  const connector = new ArsenkinWordstatConnector(allowAll(), async (url) => {
    paths.push(new URL(String(url)).pathname);
    return jsonResponse({ code: "TASK_STATUS", status: "process", progress: 45 });
  });

  assert.deepEqual(
    await connector.fetchResult(
      "42",
      ["ремонт киа"],
      ["BASE"],
      "213",
      { apiKey: "private-key" },
      1_000
    ),
    { status: "PENDING", retryAfterSeconds: 5 }
  );
  assert.deepEqual(paths, ["/api/tools/check"]);
});

test("does not invoke the lazy 10,000-keyword resolver while task is pending", async () => {
  let resolves = 0;
  const connector = new ArsenkinWordstatConnector(allowAll(), async () =>
    jsonResponse({ code: "TASK_STATUS", status: "process", progress: 45 })
  );
  assert.deepEqual(
    await connector.fetchResult(
      "42",
      async () => {
        resolves += 1;
        return Array.from({ length: 10_000 }, (_, index) => `query ${index + 1}`);
      },
      ["BASE"],
      "213",
      { apiKey: "private-key" },
      1_000
    ),
    { status: "PENDING", retryAfterSeconds: 5 }
  );
  assert.equal(resolves, 0);
});

test("calls get only after finish and returns the normalized live result", async () => {
  const paths: string[] = [];
  let permits = 0;
  const connector = new ArsenkinWordstatConnector({
    async tryAcquire() {
      permits += 1;
      return { allowed: true };
    }
  }, async (url) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    return path.endsWith("/check")
      ? jsonResponse({ code: "TASK_STATUS", status: "finish", progress: "100%" })
      : jsonResponse(liveResult({
          "ремонт киа": { base: 1200, quoted: 340, overal: 90 }
        }));
  });

  assert.deepEqual(
    await connector.fetchResult(
      "42",
      ["ремонт киа"],
      ["BASE", "EXACT", "FIXED"],
      "213",
      { apiKey: "private-key" },
      1_000
    ),
    {
      status: "READY",
      results: [{
        query: "ремонт киа",
        values: { BASE: "1200", EXACT: "340", FIXED: "90" }
      }]
    }
  );
  assert.deepEqual(paths, ["/api/tools/check", "/api/tools/get"]);
  assert.equal(permits, 2);
});

test("does not call get when the shared HTTP window fills after check", async () => {
  let permits = 0;
  const paths: string[] = [];
  const connector = new ArsenkinWordstatConnector({
    async tryAcquire() {
      permits += 1;
      return permits === 1
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: 7 };
    }
  }, async (url) => {
    paths.push(new URL(String(url)).pathname);
    return jsonResponse({
      code: "TASK_STATUS",
      status: "finish",
      progress: "100%"
    });
  });

  assert.deepEqual(
    await connector.fetchResult(
      "42",
      ["ремонт киа"],
      ["BASE"],
      "213",
      { apiKey: "private-key" },
      1_000
    ),
    {
      status: "RETRYABLE_FAILURE",
      code: "PROVIDER_RATE_LIMITED",
      retryAfterSeconds: 7
    }
  );
  assert.deepEqual(paths, ["/api/tools/check"]);
});

test("rejects premature terminal status instead of calling get", async () => {
  for (const status of [
    { code: "TASK_STATUS", status: "finish", progress: 99 },
    { code: "TASK_STATUS", status: "process", progress: 100 }
  ]) {
    const paths: string[] = [];
    const connector = new ArsenkinWordstatConnector(allowAll(), async (url) => {
      paths.push(new URL(String(url)).pathname);
      return jsonResponse(status);
    });
    assert.deepEqual(
      await connector.fetchResult(
        "42",
        ["ремонт киа"],
        ["BASE"],
        "213",
        { apiKey: "private-key" },
        1_000
      ),
      { status: "REJECTED", code: "PROVIDER_INVALID_RESPONSE" }
    );
    assert.deepEqual(paths, ["/api/tools/check"]);
  }
});

test("rejects a final Wordstat payload with mismatched task, query, or region", () => {
  const valid = liveResult({ one: { base: 1, quoted: 1, overal: 1 } });
  assert.equal(
    arsenkinWordstatBatchValues(valid, "other-task", ["one"], ["BASE"], "213"),
    undefined
  );
  assert.equal(
    arsenkinWordstatBatchValues(valid, "42", ["one", "two"], ["BASE"], "213"),
    undefined
  );
  assert.equal(
    arsenkinWordstatBatchValues(valid, "42", ["one"], ["BASE"], "225"),
    undefined
  );
  assert.equal(
    arsenkinWordstatBatchValues(
      liveResult({ one: { base: 1, quoted: 1, overal: 1 } }, null),
      "42",
      ["one"],
      ["BASE"],
      "213"
    ),
    undefined
  );
});

function liveResult(
  values: Readonly<Record<string, Readonly<Record<"base" | "quoted" | "overal", number>>>>,
  finishedAt: unknown = "2026-08-02 10:00:05"
): unknown {
  const queries = Object.keys(values);
  return {
    code: "TASK_RESULT",
    task_id: 42,
    result: {
      type: 1,
      task_id: 42,
      data: {
        device: null,
        task_id: 42,
        queries,
        regions: { "213": "Москва [213]" },
        result: Object.fromEntries(
          Object.entries(values).map(([query, row]) => [query, { "213": row }])
        )
      }
    },
    created_at: "2026-08-02 10:00:00",
    finished_at: finishedAt
  };
}

function seasonalityResult(result: unknown): unknown {
  return {
    code: "TASK_RESULT",
    task_id: 42,
    result: {
      type: 3,
      task_id: 42,
      data: {
        task_id: 42,
        queries: Object.keys(result as object),
        region: 213,
        regions: { "213": "Москва [213]" },
        group: "month",
        startdate: "2026-01-01",
        enddate: "2026-03-31",
        result
      }
    },
    created_at: "2026-09-09 06:00:00",
    finished_at: "2026-09-09 06:00:05"
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function allowAll(): ArsenkinHttpRateLimitGate {
  return {
    async tryAcquire() {
      return { allowed: true };
    }
  };
}
