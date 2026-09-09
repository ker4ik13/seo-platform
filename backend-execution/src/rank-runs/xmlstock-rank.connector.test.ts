import assert from "node:assert/strict";
import test from "node:test";
import { utf8Sha256 } from "@seo-platform/contracts/canonical-json";
import {
  XmlStockRankConnector,
  buildXmlStockRankWireRequest,
  stageXmlStockRankResult,
  xmlStockRankPageProgress,
  type XmlStockRankFetchResult,
  type XmlStockRankPageProgress
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
    { status: "PENDING", retryAfterSeconds: 25 }
  );
  const ready = await fetchLiveUntilReady(
    connector,
    submitted.taskId,
    secret,
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
    serpResults: [
      {
        position: 1,
        rankingUrl: "https://foreign.example/",
        normalizedRankingUrl: "https://foreign.example/",
        faviconUrl: "https://search-assets.example/foreign.png",
        title: "Чужой"
      },
      {
        position: 2,
        rankingUrl: "HTTPS://WWW.Example.COM:443/catalog#result",
        normalizedRankingUrl: "https://www.example.com/catalog",
        faviconUrl: "https://search-assets.example/project.png",
        title: "Каталог",
        snippet: "Купить диван"
      }
    ],
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
  const ready = await fetchLiveUntilReady(
    connector,
    submitted.taskId,
    secret,
    value
  );
  assert.equal(ready.status, "READY");
  assert.deepEqual(pages, ["0", "1", "2"]);
  if (ready.status !== "READY") return;
  const result = stageXmlStockRankResult(
    ready.value,
    submitted.taskId,
    value,
    "2026-08-02T12:00:00.000Z"
  ).snapshot.results[0];
  assert.equal(result?.position, 11);
  assert.equal(result?.serpResults?.length, 30);
});

test("classifies provider authentication, queue and rate failures", async () => {
  const cases = [
    [xml(`<response><error code="31">bad key</error></response>`), "REJECTED", "INVALID_CREDENTIAL"],
    [xml(`<response><error code="210">queued</error></response>`), "PENDING", undefined],
    [xml(`<response><error code="32">limit</error></response>`), "RETRYABLE_FAILURE", "PROVIDER_RATE_LIMITED"],
    [xml(`<response><error code="110">parallel limit</error></response>`), "RETRYABLE_FAILURE", "PROVIDER_RATE_LIMITED"],
    [xml("gateway timeout", 504), "RETRYABLE_FAILURE", "PROVIDER_UNAVAILABLE"]
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
    delayed: true,
    turbo: false
  });
});

test("collects the selected competitor depth and saves project position only on request", () => {
  const collectOnly = intent(
    "YANDEX",
    "xmlstock-yandex-search-api@2",
    { purpose: "COMPETITOR_SERP", saveProjectPosition: false, depth: 100 }
  );
  assert.equal(buildXmlStockRankWireRequest(collectOnly).depth, 100);
  const providerResult = {
    schemaVersion: "xmlstock-rank-wire-result@1",
    engine: "YANDEX",
    documents: [
      { position: 1, url: "https://foreign.example/", title: "Чужой" },
      {
        position: 2,
        url: "HTTPS://WWW.Example.COM:443/catalog#result",
        title: "Каталог",
        snippet: "Купить диван"
      }
    ]
  };
  const withoutPosition = stageXmlStockRankResult(
    providerResult,
    "task_123",
    collectOnly,
    "2026-09-02T12:00:00.000Z"
  ).snapshot.results[0];
  assert.equal(withoutPosition?.found, false);
  assert.equal(withoutPosition?.serpResults?.length, 2);

  const withPosition = stageXmlStockRankResult(
    providerResult,
    "task_123",
    intent("YANDEX", "xmlstock-yandex-search-api@2", {
      purpose: "COMPETITOR_SERP",
      saveProjectPosition: true,
      depth: 100
    }),
    "2026-09-02T12:00:00.000Z"
  ).snapshot.results[0];
  assert.equal(withPosition?.found, true);
  assert.equal(withPosition?.position, 2);
});

test("loads documented Yandex Live pages with device and language", async () => {
  const pages: string[] = [];
  const connector = new XmlStockRankConnector(async (url) => {
    const parsed = new URL(String(url));
    pages.push(parsed.searchParams.get("page") ?? "");
    assert.equal(parsed.pathname, "/yandexlive/xml/");
    assert.equal(parsed.searchParams.get("device"), "desktop");
    assert.equal(parsed.searchParams.get("lang"), "ru");
    assert.equal(parsed.searchParams.get("tbm"), "");
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
  const ready = await fetchLiveUntilReady(
    connector,
    submitted.taskId,
    secret,
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

test("uses Turbo explicitly, accepts fifty results per page and keeps Top-100 positions", async () => {
  const pages: string[] = [];
  const connector = new XmlStockRankConnector(async (url) => {
    const parsed = new URL(String(url));
    const page = Number(parsed.searchParams.get("page"));
    pages.push(String(page));
    assert.equal(parsed.pathname, "/yandexlive/xml/");
    assert.equal(parsed.searchParams.get("tbm"), "turbo");
    return xml(
      googleResult(
        page,
        page === 1 ? "https://example.com/turbo" : undefined,
        50
      )
    );
  });
  const value = intent("YANDEX", "xmlstock-yandex-live@3", { depth: 100 });
  const secret = { accountIdentifier: "owner-7", apiKey: "private-key" };
  const submitted = await connector.submit(value, secret, 1_000);
  assert.equal(submitted.status, "ACCEPTED");
  if (submitted.status !== "ACCEPTED") return;
  assert.equal(submitted.request.turbo, true);

  const first = await connector.fetchResult(
    submitted.taskId,
    secret,
    1_000,
    value
  );
  assert.equal(first.status, "CHECKPOINTED");
  if (first.status !== "CHECKPOINTED") return;
  assert.equal(first.progress.schemaVersion, "xmlstock-rank-page-progress@2");
  if (first.progress.schemaVersion !== "xmlstock-rank-page-progress@2") return;
  assert.equal(first.progress.resultsPerPage, 50);
  assert.equal(first.progress.documents.length, 50);

  const ready = await connector.fetchResult(
    submitted.taskId,
    secret,
    1_000,
    value,
    first.progress
  );
  assert.equal(ready.status, "READY");
  assert.deepEqual(pages, ["0", "1"]);
  if (ready.status !== "READY") return;
  const result = stageXmlStockRankResult(
    ready.value,
    submitted.taskId,
    value,
    "2026-08-19T12:00:00.000Z"
  ).snapshot.results[0];
  assert.equal(result?.position, 51);
  assert.equal(result?.serpResults?.length, 100);
});

test("retries Turbo code 202 after the documented 10-20 second window", async () => {
  const connector = new XmlStockRankConnector(async () =>
    xml(`<response><error code="202">pending</error></response>`)
  );
  const value = intent("YANDEX", "xmlstock-yandex-live@3", { depth: 50 });
  const submitted = await connector.submit(
    value,
    { accountIdentifier: "owner-7", apiKey: "private-key" },
    1_000
  );
  assert.equal(submitted.status, "ACCEPTED");
  if (submitted.status !== "ACCEPTED") return;
  assert.deepEqual(
    await connector.fetchResult(
      submitted.taskId,
      { accountIdentifier: "owner-7", apiKey: "private-key" },
      1_000,
      value
    ),
    { status: "PENDING", retryAfterSeconds: 15 }
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
    const ready = await fetchLiveUntilReady(
      connector,
      submitted.taskId,
      secret,
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

test("retries only the failed Live page and retains every paid checkpoint", async () => {
  const pages: string[] = [];
  let failedOnce = false;
  const connector = new XmlStockRankConnector(async (url) => {
    const page = new URL(String(url)).searchParams.get("page") ?? "";
    pages.push(page);
    if (page === "1" && !failedOnce) {
      failedOnce = true;
      return xml("temporarily unavailable", 503);
    }
    return xml(googleResult(Number(page)));
  });
  const value = intent("YANDEX", "xmlstock-yandex-live@2", { depth: 30 });
  const secret = { accountIdentifier: "owner-7", apiKey: "private-key" };
  const submitted = await connector.submit(value, secret, 1_000);
  assert.equal(submitted.status, "ACCEPTED");
  if (submitted.status !== "ACCEPTED") return;

  const first = await connector.fetchResult(
    submitted.taskId,
    secret,
    1_000,
    value
  );
  assert.equal(first.status, "CHECKPOINTED");
  if (first.status !== "CHECKPOINTED") return;
  const failed = await connector.fetchResult(
    submitted.taskId,
    secret,
    1_000,
    value,
    first.progress
  );
  assert.equal(failed.status, "RETRYABLE_FAILURE");
  const ready = await fetchLiveUntilReady(
    connector,
    submitted.taskId,
    secret,
    value,
    first.progress
  );
  assert.equal(ready.status, "READY");
  assert.deepEqual(pages, ["0", "1", "1", "2"]);
});

test("keeps persisted Live checkpoints bounded and URL-safe", () => {
  const documents = Array.from({ length: 10 }, (_, index) => ({
    position: index + 1,
    url: `https://example-${index}.com/`,
    title: "result"
  }));
  assert.equal(
    xmlStockRankPageProgress({
      schemaVersion: "xmlstock-rank-page-progress@1",
      taskId: "xmlstock-live-safe",
      engine: "YANDEX",
      depth: 30,
      nextPage: 1,
      documents
    }).documents.length,
    10
  );
  assert.throws(() =>
    xmlStockRankPageProgress({
      schemaVersion: "xmlstock-rank-page-progress@1",
      taskId: "xmlstock-live-oversized",
      engine: "YANDEX",
      depth: 30,
      nextPage: 1,
      documents: documents.map((document, index) =>
        index === 0
          ? { ...document, snippet: "x".repeat(8_193) }
          : document
      )
    })
  );
});

async function fetchLiveUntilReady(
  connector: XmlStockRankConnector,
  taskId: string,
  secret: { readonly accountIdentifier: string; readonly apiKey: string },
  value: RankProviderRequestIntentV1,
  initialProgress?: XmlStockRankPageProgress
): Promise<Extract<XmlStockRankFetchResult, { readonly status: "READY" }>> {
  let progress = initialProgress;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await connector.fetchResult(
      taskId,
      secret,
      1_000,
      value,
      progress
    );
    if (result.status === "READY") return result;
    assert.equal(result.status, "CHECKPOINTED");
    if (result.status !== "CHECKPOINTED") break;
    progress = result.progress;
  }
  throw new Error("Live result was not completed within ten pages");
}

function intent(
  searchEngine: "YANDEX" | "GOOGLE",
  providerMappingVersion = "xmlstock-serp@1",
  overrides: {
    readonly device?: "DESKTOP" | "MOBILE";
    readonly depth?: 30 | 50 | 100;
    readonly purpose?: "COMPETITOR_SERP";
    readonly saveProjectPosition?: boolean;
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
      ...(overrides.purpose ? { purpose: overrides.purpose } : {}),
      ...(overrides.saveProjectPosition === undefined
        ? {}
        : { saveProjectPosition: overrides.saveProjectPosition }),
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
  return `<?xml version="1.0"?><yandexsearch><response><results><grouping><group><doc><url>https://foreign.example/</url><favicon>https://search-assets.example/foreign.png</favicon><title>Чужой</title></doc></group><group><doc><url>HTTPS://WWW.Example.COM:443/catalog#result</url><icon src="https://search-assets.example/project.png"/><title>Каталог</title><passages><passage>Купить диван</passage></passages></doc></group></grouping></results></response></yandexsearch>`;
}

function googleResult(page: number, projectUrl?: string, count = 10): string {
  const docs = Array.from({ length: count }, (_, index) => {
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
