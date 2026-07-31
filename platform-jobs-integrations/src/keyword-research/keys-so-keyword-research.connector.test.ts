import assert from "node:assert/strict";
import test from "node:test";
import { KeysSoKeywordResearchConnector } from "./keys-so-keyword-research.connector.js";

test("collects and normalizes one bounded Keys.so organic keyword page", async () => {
  let observedUrl = "";
  let observedToken = "";
  const connector = new KeysSoKeywordResearchConnector(
    (async (input, init) => {
      observedUrl = String(input);
      observedToken = new Headers(init?.headers).get("X-Keyso-TOKEN") ?? "";
      return Response.json({
        current_page: 2,
        last_page: 4,
        total: 76,
        data: [
          {
            id: 42,
            word: "  seo аудит  ",
            url: "/services/audit",
            ws: 1000,
            wsk: "250",
            superwsk: 80,
            pos: 3,
            kei: "12.5"
          }
        ]
      });
    }) as typeof fetch
  );

  const result = await connector.collect(
    { domain: "example.ru", database: "msk", page: 2 },
    { apiKey: "secret-token" },
    1_000
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.rows, [
    {
      providerRowId: "42",
      keyword: "seo аудит",
      url: "/services/audit",
      frequencyBase: 1000,
      frequencyExact: 250,
      frequencyFixed: 80,
      position: 3,
      kei: 12.5
    }
  ]);
  assert.equal(result.totalAvailable, 76);
  assert.equal(result.lastPage, 4);
  assert.equal(observedToken, "secret-token");
  const url = new URL(observedUrl);
  assert.equal(url.origin, "https://api.keys.so");
  assert.equal(url.pathname, "/report/simple/organic/keywords");
  assert.equal(url.searchParams.get("domain"), "example.ru");
  assert.equal(url.searchParams.get("base"), "msk");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("per_page"), "25");
});

test("preserves bounded Retry-After on Keys.so rate limiting", async () => {
  const connector = new KeysSoKeywordResearchConnector(
    (async () =>
      Response.json(
        { error: "rate limited" },
        { status: 429, headers: { "Retry-After": "45" } }
      )) as typeof fetch
  );
  assert.deepEqual(
    await connector.collect(
      { domain: "example.ru", database: "msk", page: 1 },
      { apiKey: "secret-token" },
      1_000
    ),
    {
      ok: false,
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 45
    }
  );
});

test("fails closed on an oversized or malformed provider page", async () => {
  const connector = new KeysSoKeywordResearchConnector(
    (async () =>
      Response.json({
        data: Array.from({ length: 26 }, (_, index) => ({
          word: `keyword-${index}`
        }))
      })) as typeof fetch
  );
  assert.deepEqual(
    await connector.collect(
      { domain: "example.ru", database: "msk", page: 1 },
      { apiKey: "secret-token" },
      1_000
    ),
    {
      ok: false,
      code: "PROVIDER_UNAVAILABLE",
      retryable: true
    }
  );
});
