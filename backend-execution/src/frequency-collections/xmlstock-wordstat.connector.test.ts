import assert from "node:assert/strict";
import test from "node:test";
import {
  XmlStockWordstatConnector,
  WordstatQueryError,
  wordstatQuery,
  xmlStockSeasonalityResult,
  xmlStockWordstatExpansionResult,
  xmlStockWordstatResult
} from "./xmlstock-wordstat.connector.js";

test("builds base, phrase and fixed Wordstat operators", () => {
  assert.equal(wordstatQuery("купить слона", "BASE"), "купить слона");
  assert.equal(wordstatQuery("купить слона", "EXACT"), '"купить слона"');
  assert.equal(wordstatQuery("купить слона", "FIXED"), '"!купить !слона"');
});

test("rejects an operator-expanded query beyond the provider limit", () => {
  assert.throws(
    () => wordstatQuery("а".repeat(399), "EXACT"),
    WordstatQueryError
  );
});

test("collects frequency without exposing credentials outside the request URL", async () => {
  let url: URL | undefined;
  const connector = new XmlStockWordstatConnector(async (input) => {
    url = new URL(String(input));
    return Response.json({ totalCount: "8960", results: [] });
  });
  assert.deepEqual(
    await connector.collect(
      { keyword: "генератор изображений", type: "BASE", regionCode: "213", device: "ALL" },
      { apiKey: "secret", accountIdentifier: "42" },
      1_000
    ),
    { ok: true, value: "8960" }
  );
  assert.equal(url?.searchParams.get("pagetype"), "words");
  assert.equal(url?.searchParams.get("groupby"), "1");
  assert.equal(url?.searchParams.get("regions"), "213");
  assert.equal(url?.searchParams.get("device"), "all");
});

test("collects XMLStock monthly seasonality with explicit operators and range", async () => {
  let url: URL | undefined;
  const connector = new XmlStockWordstatConnector(async (input) => {
    url = new URL(String(input));
    return Response.json({
      results: [
        { date: "2025-01-01T00:00:00Z", count: "120", share: "0.00012" },
        { date: "2025-02-01T00:00:00Z", count: "80", share: "0.00008" }
      ]
    });
  });
  assert.deepEqual(await connector.collectSeasonality({
    keyword: "купить слона",
    type: "FIXED",
    regionCode: "225",
    device: "DESKTOP",
    seasonality: {
      granularity: "MONTH",
      observedFrom: "2025-01-01",
      observedThrough: "2025-02-28"
    }
  }, { apiKey: "secret", accountIdentifier: "42" }, 1_000), {
    ok: true,
    points: [
      { periodStart: "2025-01-01", value: "120", share: "0.00012" },
      { periodStart: "2025-02-01", value: "80", share: "0.00008" }
    ]
  });
  assert.equal(url?.searchParams.get("query"), '"!купить !слона"');
  assert.equal(url?.searchParams.get("pagetype"), "history");
  assert.equal(url?.searchParams.get("period"), "month");
  assert.equal(url?.searchParams.get("start"), "01.01.2025");
  assert.equal(url?.searchParams.get("end"), "28.02.2025");
  assert.equal(url?.searchParams.get("regions"), "225");
  assert.equal(url?.searchParams.get("device"), "desktop");
});

test("accepts the numeric share currently returned by the live history endpoint", () => {
  assert.deepEqual(xmlStockSeasonalityResult(200, {
    results: [{
      date: "2025-01-01T00:00:00Z",
      count: "120",
      share: 0.00012
    }]
  }, {
    granularity: "MONTH",
    observedFrom: "2025-01-01",
    observedThrough: "2025-01-31"
  }), {
    ok: true,
    points: [{ periodStart: "2025-01-01", value: "120", share: "0.00012" }]
  });
});

test("projects XMLStock date-only history periods as zero demand", () => {
  assert.deepEqual(xmlStockSeasonalityResult(200, {
    results: [
      { date: "2025-09-01T00:00:00Z" },
      { date: "2025-10-01T00:00:00Z" },
      {
        date: "2025-11-01T00:00:00Z",
        count: "16",
        share: 1.507019066431582e-7
      }
    ]
  }, {
    granularity: "MONTH",
    observedFrom: "2025-09-01",
    observedThrough: "2025-11-30"
  }), {
    ok: true,
    points: [
      { periodStart: "2025-09-01", value: "0" },
      { periodStart: "2025-10-01", value: "0" },
      {
        periodStart: "2025-11-01",
        value: "16",
        share: "0.000000150701906643"
      }
    ]
  });
});

test("rejects a history period with share but no count", () => {
  assert.deepEqual(xmlStockSeasonalityResult(200, {
    results: [{
      date: "2025-09-01T00:00:00Z",
      share: "0.00012"
    }]
  }, {
    granularity: "MONTH",
    observedFrom: "2025-09-01",
    observedThrough: "2025-09-30"
  }), {
    ok: false,
    code: "PROVIDER_INVALID_RESPONSE",
    retryable: true
  });
});

test("rejects malformed or unordered XMLStock seasonality", () => {
  assert.deepEqual(xmlStockSeasonalityResult(200, {
    results: [
      { date: "2025-02-01T00:00:00Z", count: "80" },
      { date: "2025-01-01T00:00:00Z", count: "120" }
    ]
  }, {
    granularity: "MONTH",
    observedFrom: "2025-01-01",
    observedThrough: "2025-02-28"
  }), {
    ok: false,
    code: "PROVIDER_INVALID_RESPONSE",
    retryable: true
  });
});

test("accepts the live XMLStock grouped operator response without totalCount", async () => {
  const connector = new XmlStockWordstatConnector(async () =>
    Response.json({
      results: [{ phrase: "как зайти в нано банана", count: "1" }],
      associations: []
    })
  );
  assert.deepEqual(
    await connector.collect(
      {
        keyword: "Как зайти   в нано банана",
        type: "EXACT",
        regionCode: "213",
        device: "ALL"
      },
      { apiKey: "secret", accountIdentifier: "42" },
      1_000
    ),
    { ok: true, value: "1" }
  );
});

test("accepts a single aggregate row when XMLStock normalizes its phrase", () => {
  assert.deepEqual(
    xmlStockWordstatResult(
      200,
      { results: [{ phrase: "купим ии фото", count: "16" }] },
      "купить ии фото",
      "EXACT"
    ),
    { ok: true, value: "16" }
  );
});

test("does not attribute several non-matching Wordstat rows to the keyword", () => {
  assert.deepEqual(
    xmlStockWordstatResult(
      200,
      {
        results: [
          { phrase: "другой запрос", count: "55" },
          { phrase: "ещё запрос", count: "21" }
        ]
      },
      "исходный запрос",
      "EXACT"
    ),
    {
      ok: false,
      code: "PROVIDER_INVALID_RESPONSE",
      retryable: true
    }
  );
});

test("accepts an empty Wordstat result as zero frequency", () => {
  assert.deepEqual(
    xmlStockWordstatResult(
      200,
      { results: [], associations: [] },
      "нет спроса",
      "FIXED"
    ),
    { ok: true, value: "0" }
  );
});

test("never substitutes broad totalCount for phrase or fixed frequency", () => {
  const response = {
    totalCount: "244",
    results: [{ phrase: "промты для нейросети ии", count: "2" }]
  };
  assert.deepEqual(
    xmlStockWordstatResult(
      200,
      response,
      "промты для нейросети ии",
      "BASE"
    ),
    { ok: true, value: "244" }
  );
  assert.deepEqual(
    xmlStockWordstatResult(
      200,
      response,
      "промты для нейросети ии",
      "EXACT"
    ),
    { ok: true, value: "2" }
  );
  assert.deepEqual(
    xmlStockWordstatResult(
      200,
      { totalCount: "244", results: [] },
      "промты для нейросети ии",
      "FIXED"
    ),
    { ok: true, value: "0" }
  );
});

test("pins explicit all-region collection instead of inheriting account defaults", async () => {
  let url: URL | undefined;
  const connector = new XmlStockWordstatConnector(async (input) => {
    url = new URL(String(input));
    return Response.json({ totalCount: "1", results: [] });
  });
  await connector.collect(
    { keyword: "слон", type: "BASE", regionCode: "ALL", device: "ALL" },
    { apiKey: "secret", accountIdentifier: "42" },
    1_000
  );
  assert.equal(url?.searchParams.get("regions"), "all");
});

test("expands a phrase through XMLStock results and associations", async () => {
  let url: URL | undefined;
  const connector = new XmlStockWordstatConnector(async (input) => {
    url = new URL(String(input));
    return Response.json({
      totalCount: "120",
      results: [
        { phrase: "купить холодильник", count: "70" },
        { phrase: "холодильник цена", count: "45" }
      ],
      associations: [{ phrase: "морозильная камера", count: "21" }]
    });
  });

  const result = await connector.expand(
    {
      query: "холодильник",
      regionCode: "225",
      device: "ALL",
      minusWords: ["бесплатно"],
      clearMinusPhrases: false,
      includeRightColumn: true,
      clearPlus: false,
      maxKeywords: 500
    },
    { apiKey: "secret", accountIdentifier: "42" },
    1_000
  );

  assert.equal(result.ok, true);
  if (!result.ok) assert.fail();
  assert.deepEqual(
    result.rows.map(({ keyword, sourceColumn }) => ({ keyword, sourceColumn })),
    [
      { keyword: "холодильник", sourceColumn: "LEFT" },
      { keyword: "купить холодильник", sourceColumn: "LEFT" },
      { keyword: "холодильник цена", sourceColumn: "LEFT" },
      { keyword: "морозильная камера", sourceColumn: "RIGHT" }
    ]
  );
  assert.equal(url?.searchParams.get("pagetype"), "words");
  assert.equal(url?.searchParams.get("groupby"), "500");
  assert.equal(url?.searchParams.get("regions"), "225");
  assert.equal(url?.searchParams.get("query"), "холодильник -бесплатно");
});

test("rejects a malformed XMLStock expansion response", () => {
  assert.deepEqual(
    xmlStockWordstatExpansionResult(
      200,
      { results: [{ phrase: "запрос", count: "not-a-count" }], associations: [] },
      "запрос",
      true,
      100
    ),
    { ok: false, code: "PROVIDER_INVALID_RESPONSE", retryable: true }
  );
});

test("normalizes XMLStock low balance and rate-limit errors", () => {
  assert.deepEqual(xmlStockWordstatResult(200, { error: 200 }, "запрос", "BASE"), {
    ok: false,
    code: "PROVIDER_LOW_BALANCE",
    retryable: false
  });
  assert.deepEqual(xmlStockWordstatResult(200, { error: 55 }, "запрос", "BASE"), {
    ok: false,
    code: "PROVIDER_RATE_LIMITED",
    retryable: true
  });
  assert.deepEqual(xmlStockWordstatResult(503, { error: 503 }, "запрос", "BASE"), {
    ok: false,
    code: "PROVIDER_RATE_LIMITED",
    retryable: true
  });
  assert.deepEqual(xmlStockWordstatResult(200, { error: 32 }, "запрос", "BASE"), {
    ok: false,
    code: "PROVIDER_RATE_LIMITED",
    retryable: true
  });
  assert.deepEqual(xmlStockWordstatResult(200, { error: 110 }, "запрос", "BASE"), {
    ok: false,
    code: "PROVIDER_RATE_LIMITED",
    retryable: true
  });
});
