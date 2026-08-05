import assert from "node:assert/strict";
import test from "node:test";
import {
  XmlStockWordstatConnector,
  WordstatQueryError,
  wordstatQuery,
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
      "купить ии фото"
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
      "исходный запрос"
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
    xmlStockWordstatResult(200, { results: [], associations: [] }, "нет спроса"),
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

test("normalizes XMLStock low balance and rate-limit errors", () => {
  assert.deepEqual(xmlStockWordstatResult(200, { error: 200 }), {
    ok: false,
    code: "PROVIDER_LOW_BALANCE",
    retryable: false
  });
  assert.deepEqual(xmlStockWordstatResult(200, { error: 55 }), {
    ok: false,
    code: "PROVIDER_RATE_LIMITED",
    retryable: true
  });
  assert.deepEqual(xmlStockWordstatResult(503, { error: 503 }), {
    ok: false,
    code: "PROVIDER_RATE_LIMITED",
    retryable: true
  });
  assert.deepEqual(xmlStockWordstatResult(200, { error: 32 }), {
    ok: false,
    code: "PROVIDER_RATE_LIMITED",
    retryable: true
  });
});
