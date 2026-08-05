import assert from "node:assert/strict";
import test from "node:test";
import { utf8Sha256 } from "@seo-platform/contracts/canonical-json";
import {
  XmlStockRankConnector,
  buildXmlStockRankWireRequest,
  stageXmlStockRankResult
} from "./xmlstock-rank.connector.js";
import type { RankProviderRequestIntentV1 } from "./rank-provider-request-intent.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  jobId: "01900000-0000-7000-8000-000000000004",
  jobItemId: "01900000-0000-7000-8000-000000000005",
  estimateId: "01900000-0000-7000-8000-000000000006",
  manifestId: "01900000-0000-7000-8000-000000000007",
  entryId: "01900000-0000-7000-8000-000000000008",
  keywordId: "01900000-0000-7000-8000-000000000009"
} as const;

test("submits one delayed Yandex request and polls only by req_id", async () => {
  const calls: URL[] = [];
  const responses = [
    xml(`<?xml version="1.0"?><yandexsearch><response><req_id>task_123</req_id></response></yandexsearch>`),
    xml(`<?xml version="1.0"?><yandexsearch><response><error code="202">pending</error></response></yandexsearch>`),
    xml(yandexResult())
  ];
  const connector = new XmlStockRankConnector(async (url, init) => {
    calls.push(new URL(String(url)));
    assert.equal(init?.method, "GET");
    const response = responses.shift();
    assert.ok(response);
    return response;
  });
  const value = intent("YANDEX");
  const secret = { accountIdentifier: "owner-7", apiKey: "private-key" };

  const submitted = await connector.submit(value, secret, 1_000);
  assert.equal(submitted.status, "ACCEPTED");
  if (submitted.status !== "ACCEPTED") return;
  assert.equal(submitted.taskId, "task_123");
  assert.equal(calls[0]?.pathname, "/yandex/xml/");
  assert.equal(calls[0]?.searchParams.get("delayed"), "1");
  assert.equal(calls[0]?.searchParams.get("query"), "купить диван");
  assert.equal(calls[0]?.searchParams.get("groupby"), "30");
  assert.equal(calls[0]?.searchParams.get("lr"), "213");

  assert.deepEqual(
    await connector.fetchResult(submitted.taskId, secret, 1_000, value),
    { status: "PENDING" }
  );
  const ready = await connector.fetchResult(
    submitted.taskId,
    secret,
    1_000,
    value
  );
  assert.equal(ready.status, "READY");
  assert.equal(calls[1]?.searchParams.get("req_id"), "task_123");
  assert.equal(calls[1]?.searchParams.has("query"), false);
  assert.equal(calls[2]?.searchParams.get("req_id"), "task_123");

  if (ready.status !== "READY") return;
  const staged = stageXmlStockRankResult(
    ready.value,
    submitted.taskId,
    value,
    "2026-08-02T12:00:00.000Z"
  );
  assert.deepEqual(staged.snapshot.results, [{
    manifestEntryId: ids.entryId,
    keywordId: ids.keywordId,
    found: true,
    position: 2,
    rankingUrl: "HTTPS://WWW.Example.COM:443/catalog#result",
    normalizedRankingUrl: "https://www.example.com/catalog",
    title: "Каталог",
    snippet: "Купить диван",
    resultType: "ORGANIC",
    serpFeatures: [],
    dataQualityFlags: [
      "PROVIDER_OBSERVED_AT_UNAVAILABLE",
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE"
    ]
  }]);
});

test("loads each documented Google result page once and keeps absolute positions", async () => {
  const pages: string[] = [];
  const connector = new XmlStockRankConnector(async (url) => {
    const parsed = new URL(String(url));
    pages.push(parsed.searchParams.get("page") ?? "");
    assert.equal(parsed.pathname, "/google/xml/");
    assert.equal(parsed.searchParams.get("device"), "desktop");
    assert.equal(parsed.searchParams.get("domain"), "ru");
    assert.equal(parsed.searchParams.get("hl"), "ru");
    const page = Number(parsed.searchParams.get("page"));
    return xml(googleResult(page, page === 1 ? "https://example.com/result" : undefined));
  });
  const value = intent("GOOGLE");
  const secret = { accountIdentifier: "owner-7", apiKey: "private-key" };

  const submitted = await connector.submit(value, secret, 1_000);
  assert.equal(submitted.status, "ACCEPTED");
  if (submitted.status !== "ACCEPTED") return;
  const ready = await connector.fetchResult(
    submitted.taskId,
    secret,
    1_000,
    value
  );
  assert.equal(ready.status, "READY");
  assert.deepEqual(pages, ["0", "1", "2"]);
  if (ready.status !== "READY") return;
  assert.equal(
    stageXmlStockRankResult(
      ready.value,
      submitted.taskId,
      value,
      "2026-08-02T12:00:00.000Z"
    ).snapshot.results[0]?.position,
    11
  );
});

test("classifies provider authentication, queue and rate failures", async () => {
  const cases = [
    [xml(`<response><error code="31">bad key</error></response>`), "REJECTED", "INVALID_CREDENTIAL"],
    [xml(`<response><error code="210">queued</error></response>`), "PENDING", undefined],
    [xml(`<response><error code="32">limit</error></response>`), "RETRYABLE_FAILURE", "PROVIDER_RATE_LIMITED"]
  ] as const;
  const value = intent("YANDEX");
  const secret = { accountIdentifier: "owner-7", apiKey: "private-key" };
  for (const [response, status, code] of cases) {
    const connector = new XmlStockRankConnector(async () => response);
    const result = await connector.fetchResult("task_123", secret, 1_000, value);
    assert.equal(result.status, status);
    if (code && "code" in result) assert.equal(result.code, code);
  }
});

test("builds a secret-free one-key wire request", () => {
  assert.deepEqual(buildXmlStockRankWireRequest(intent("YANDEX")), {
    provider: "XMLSTOCK",
    engine: "YANDEX",
    source: "SEARCH_API",
    query: "купить диван",
    regionCode: "213",
    countryCode: "RU",
    language: "ru",
    device: "DESKTOP",
    depth: 30,
    delayed: true
  });
});

test("loads documented Yandex Live pages with device and language", async () => {
  const pages: string[] = [];
  const connector = new XmlStockRankConnector(async (url) => {
    const parsed = new URL(String(url));
    pages.push(parsed.searchParams.get("page") ?? "");
    assert.equal(parsed.pathname, "/yandexlive/xml/");
    assert.equal(parsed.searchParams.get("device"), "desktop");
    assert.equal(parsed.searchParams.get("lang"), "ru");
    const page = Number(parsed.searchParams.get("page"));
    return xml(
      googleResult(page, page === 2 ? "https://example.com/live" : undefined)
    );
  });
  const value = intent("YANDEX", "xmlstock-yandex-live@2");
  const secret = { accountIdentifier: "owner-7", apiKey: "private-key" };

  const submitted = await connector.submit(value, secret, 1_000);
  assert.equal(submitted.status, "ACCEPTED");
  if (submitted.status !== "ACCEPTED") return;
  assert.equal(submitted.request.source, "LIVE");
  assert.equal(submitted.request.delayed, false);
  const ready = await connector.fetchResult(
    submitted.taskId,
    secret,
    1_000,
    value
  );
  assert.equal(ready.status, "READY");
  assert.deepEqual(pages, ["0", "1", "2"]);
  if (ready.status !== "READY") return;
  assert.equal(
    stageXmlStockRankResult(
      ready.value,
      submitted.taskId,
      value,
      "2026-08-02T12:00:00.000Z"
    ).snapshot.results[0]?.position,
    21
  );
});

test("loads every Top-100 Live page on mobile for Yandex and Google", async () => {
  for (const [searchEngine, providerMappingVersion, pathname] of [
    ["YANDEX", "xmlstock-yandex-live@2", "/yandexlive/xml/"],
    ["GOOGLE", "xmlstock-google-live@2", "/google/xml/"]
  ] as const) {
    const pages: string[] = [];
    const connector = new XmlStockRankConnector(async (url) => {
      const parsed = new URL(String(url));
      const page = Number(parsed.searchParams.get("page"));
      pages.push(parsed.searchParams.get("page") ?? "");
      assert.equal(parsed.pathname, pathname);
      assert.equal(parsed.searchParams.get("device"), "mobile");
      return xml(
        googleResult(
          page,
          page === 9 ? "https://example.com/top-100" : undefined
        )
      );
    });
    const value = intent(searchEngine, providerMappingVersion, {
      device: "MOBILE",
      depth: 100
    });
    const secret = { accountIdentifier: "owner-7", apiKey: "private-key" };

    const submitted = await connector.submit(value, secret, 1_000);
    assert.equal(submitted.status, "ACCEPTED");
    if (submitted.status !== "ACCEPTED") continue;
    const ready = await connector.fetchResult(
      submitted.taskId,
      secret,
      1_000,
      value
    );
    assert.equal(ready.status, "READY");
    assert.deepEqual(
      pages,
      Array.from({ length: 10 }, (_, page) => String(page))
    );
    if (ready.status !== "READY") continue;
    assert.equal(
      stageXmlStockRankResult(
        ready.value,
        submitted.taskId,
        value,
        "2026-08-02T12:00:00.000Z"
      ).snapshot.results[0]?.position,
      91
    );
  }
});

function intent(
  searchEngine: "YANDEX" | "GOOGLE",
  providerMappingVersion = "xmlstock-serp@1",
  overrides: {
    readonly device?: "DESKTOP" | "MOBILE";
    readonly depth?: 30 | 50 | 100;
  } = {}
): RankProviderRequestIntentV1 {
  return {
    schemaVersion: "rank-provider-request-intent@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    jobItemId: ids.jobItemId,
    estimateId: ids.estimateId,
    provider: "XMLSTOCK",
    operation: "POSITIONS",
    project: { domain: "example.com", version: 1 },
    execution: {
      searchEngine,
      countryCode: "RU",
      regionCode: "213",
      language: "ru",
      device: overrides.device ?? "DESKTOP",
      depth: overrides.depth ?? 30,
      domainMatchRule: { mode: "INCLUDE_WWW" },
      safeSearch: false,
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE",
      providerMappingVersion
    },
    manifest: {
      id: ids.manifestId,
      hashSchemaVersion: "rank-manifest@1",
      manifestHash: hash("a"),
      pairCount: "1"
    },
    manifestChunk: {
      manifestId: ids.manifestId,
      chunkIndex: 0,
      hashSchemaVersion: "rank-manifest-chunk@1",
      chunkHash: hash("b")
    },
    executionConnectorVersion: "xmlstock-serp@1.0.0",
    providerPolicyVersion: "manual-xmlstock-serp@1.0.0",
    keywords: [{
      manifestEntryId: ids.entryId,
      sequence: 0,
      keywordId: ids.keywordId,
      keywordText: "купить диван",
      keywordTextHash: {
        algorithm: "SHA_256",
        value: utf8Sha256("купить диван")
      },
      language: "ru"
    }]
  };
}

function yandexResult(): string {
  return `<?xml version="1.0"?><yandexsearch><response><results><grouping><group><doc><url>https://foreign.example/</url><title>Чужой</title></doc></group><group><doc><url>HTTPS://WWW.Example.COM:443/catalog#result</url><title>Каталог</title><passages><passage>Купить диван</passage></passages></doc></group></grouping></results></response></yandexsearch>`;
}

function googleResult(page: number, projectUrl?: string): string {
  const docs = Array.from({ length: 10 }, (_, index) => {
    const url = index === 0 && projectUrl
      ? projectUrl
      : `https://foreign-${page}-${index}.example/`;
    return `<doc><url>${url}</url><title>Result</title></doc>`;
  }).join("");
  return `<response><results>${docs}</results></response>`;
}

function hash(character: string): {
  readonly algorithm: "SHA_256";
  readonly value: string;
} {
  return { algorithm: "SHA_256", value: character.repeat(64) };
}

function xml(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: { "Content-Type": "application/xml; charset=utf-8" }
  });
}
