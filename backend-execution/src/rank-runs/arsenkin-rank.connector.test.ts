import assert from "node:assert/strict";
import test from "node:test";
import { utf8Sha256 } from "@seo-platform/contracts/canonical-json";
import type { ArsenkinHttpRateLimitGate } from "../integrations/arsenkin-http-rate-limiter.js";
import {
  ArsenkinRankConnector,
  arsenkinRankWireRequestHash,
  buildArsenkinRankWireRequest,
  normalizeArsenkinRankResult,
  stageArsenkinRankResult
} from "./arsenkin-rank.connector.js";
import type { RankProviderRequestIntentV1 } from "./rank-provider-request-intent.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  jobId: "01900000-0000-7000-8000-000000000004",
  jobItemId: "01900000-0000-7000-8000-000000000005",
  estimateId: "01900000-0000-7000-8000-000000000006",
  manifestId: "01900000-0000-7000-8000-000000000007",
  firstEntryId: "01900000-0000-7000-8000-000000000008",
  secondEntryId: "01900000-0000-7000-8000-000000000009",
  firstKeywordId: "01900000-0000-7000-8000-000000000010",
  secondKeywordId: "01900000-0000-7000-8000-000000000011"
} as const;

test("builds the documented positions payload with exact query order and tracking URL", () => {
  const request = buildArsenkinRankWireRequest(intent());
  assert.deepEqual(request, {
    tools_name: "positions",
    data: {
      queries: ["купить диван", "seo audit"],
      url: "https://example.com/",
      alt_urls: ["https://www.example.com/"],
      subdomain: false,
      se: [{ type: 11, region: 1011969, depth: 30 }],
      format: 0
    }
  });
  assert.deepEqual(
    buildArsenkinRankWireRequest(
      intent({ execution: { ...intent().execution, device: "MOBILE" } })
    ).data.se,
    [{ type: 12, region: 1011969, depth: 30 }]
  );
  assert.deepEqual(
    buildArsenkinRankWireRequest(
      intent({
        execution: {
          ...intent().execution,
          searchEngine: "YANDEX",
          device: "DESKTOP",
          depth: 30
        }
      })
    ).data,
    {
      queries: ["купить диван", "seo audit"],
      url: "https://example.com/",
      alt_urls: ["https://www.example.com/"],
      subdomain: false,
      se: [{ type: 2, region: 1011969 }],
      format: 0
    }
  );
  assert.deepEqual(
    buildArsenkinRankWireRequest(
      intent({
        execution: {
          ...intent().execution,
          searchEngine: "YANDEX",
          device: "MOBILE",
          depth: 30
        }
      })
    ).data.se,
    [{ type: 3, region: 1011969 }]
  );
  const yandexSearchApi = buildArsenkinRankWireRequest(
    intent({
      execution: {
        ...intent().execution,
        searchEngine: "YANDEX",
        device: "DESKTOP",
        depth: 30,
        providerMappingVersion: "arsenkin-yandex-search-api@2"
      }
    })
  );
  assert.deepEqual(yandexSearchApi.data.se, [
    { type: 1, region: 1011969 }
  ]);
  assert.doesNotThrow(() => arsenkinRankWireRequestHash(yandexSearchApi));
});

test("uses Check Top for new position mappings and derives the project position from its SERP", () => {
  const base = intent();
  const checkTopPosition = intent({
    execution: {
      ...base.execution,
      providerMappingVersion: "arsenkin-check-top-google-live@1"
    }
  });

  assert.deepEqual(buildArsenkinRankWireRequest(checkTopPosition), {
    tools_name: "check-top",
    data: {
      queries: ["купить диван", "seo audit"],
      is_snippet: true,
      noreask: false,
      se: [{ type: 11, region: 1011969 }],
      depth: 30
    }
  });

  const normalized = normalizeArsenkinRankResult(
    checkTopResultBody(),
    "3944",
    checkTopPosition
  );
  assert.equal(normalized[0]?.found, true);
  assert.equal(normalized[0]?.position, 2);
  assert.equal(normalized[0]?.serpResults?.length, 2);
  assert.equal(normalized[0]?.serpResults?.[0]?.title, "Конкурент");
  assert.equal(normalized[1]?.found, false);
});

test("normalizes the transposed Check Top collect shape returned by Arsenkin", () => {
  const value = checkTopResultBody() as {
    result: { result: { collect: unknown } };
  };
  value.result.result.collect = [
    [[
      "https://competitor.example/one",
      "https://www.example.com/catalog"
    ]],
    [["https://competitor.example/audit"]]
  ];
  const checkTopPosition = intent({
    execution: {
      ...intent().execution,
      providerMappingVersion: "arsenkin-check-top-google-live@1"
    }
  });

  const normalized = normalizeArsenkinRankResult(
    value,
    "3944",
    checkTopPosition
  );
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0]?.found, true);
  assert.equal(normalized[0]?.position, 2);
  assert.equal(normalized[1]?.found, false);
});

test("builds and normalizes documented Check Top competitor output", () => {
  const collectOnly = competitorIntent(false);
  assert.deepEqual(buildArsenkinRankWireRequest(collectOnly), {
    tools_name: "check-top",
    data: {
      queries: ["купить диван", "seo audit"],
      is_snippet: true,
      noreask: false,
      se: [{ type: 11, region: 1011969 }],
      depth: 30
    }
  });

  const providerResult = checkTopResultBody();
  const withoutPosition = normalizeArsenkinRankResult(
    providerResult,
    "3944",
    collectOnly
  );
  assert.equal(withoutPosition[0]?.found, false);
  assert.equal(withoutPosition[0]?.serpResults?.length, 2);
  assert.equal(withoutPosition[0]?.serpResults?.[0]?.title, "Конкурент");

  const withPosition = normalizeArsenkinRankResult(
    providerResult,
    "3944",
    competitorIntent(true)
  );
  assert.equal(withPosition[0]?.found, true);
  assert.equal(withPosition[0]?.position, 2);
  assert.equal(withPosition[0]?.rankingUrl, "https://www.example.com/catalog");
  assert.equal(withPosition[1]?.found, false);
});

test("submits only through POST with Bearer auth and keeps transport ambiguity explicit", async () => {
  let called = false;
  let permits = 0;
  let receivedScope: string | undefined;
  const connector = new ArsenkinRankConnector({
    async tryAcquire(scopeId) {
      permits += 1;
      receivedScope = scopeId;
      return { allowed: true };
    }
  }, async (url, init) => {
    called = true;
    assert.equal(String(url), "https://arsenkin.ru/api/tools/set");
    assert.equal(init?.method, "POST");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer private-key"
    );
    assert.deepEqual(
      JSON.parse(String(init?.body)),
      buildArsenkinRankWireRequest(intent())
    );
    return json({ task_id: 3944 });
  });
  assert.deepEqual(
    await connector.submit(
      intent(),
      {
        apiKey: "private-key",
        rateLimitScopeId: "01900000-0000-8000-8000-000000000001"
      },
      1_000
    ),
    {
      status: "ACCEPTED",
      taskId: "3944",
      request: buildArsenkinRankWireRequest(intent())
    }
  );
  assert.equal(called, true);
  assert.equal(permits, 1);
  assert.equal(
    receivedScope,
    "01900000-0000-8000-8000-000000000001"
  );

  const ambiguous = new ArsenkinRankConnector(allowAll(), async () => {
    throw new Error("connection reset");
  });
  assert.deepEqual(
    await ambiguous.submit(intent(), { apiKey: "private-key" }, 1_000),
    {
      status: "OUTCOME_UNKNOWN",
      code: "PROVIDER_TRANSPORT_AMBIGUOUS"
    }
  );
});

test("keeps one positions provider task for a stored legacy 250-key chunk", async () => {
  const keywords = keywordEntries(250);
  const base = intent();
  const batchIntent = intent({
    manifest: { ...base.manifest, pairCount: "250" },
    keywords
  });
  let submissions = 0;
  const connector = new ArsenkinRankConnector(allowAll(), async (_url, init) => {
    submissions += 1;
    const body = JSON.parse(String(init?.body)) as {
      readonly tools_name: string;
      readonly data: { readonly queries: readonly string[] };
    };
    assert.equal(body.tools_name, "positions");
    assert.equal(body.data.queries.length, 250);
    assert.equal(body.data.queries[0], "query 1");
    assert.equal(body.data.queries[249], "query 250");
    return json({ task_id: 3944 });
  });

  const result = await connector.submit(
    batchIntent,
    { apiKey: "private-key" },
    1_000
  );
  assert.equal(result.status, "ACCEPTED");
  assert.equal(submissions, 1);
});

test("submits the current 15,000-key positions scope as exactly one provider task", async () => {
  const keywordCount = 15_000;
  const base = intent();
  const batchIntent = intent({
    providerPolicyVersion: "manual-arsenkin-positions@2.0.0",
    manifest: { ...base.manifest, pairCount: String(keywordCount) },
    keywords: keywordEntries(keywordCount)
  });
  let submissions = 0;
  const connector = new ArsenkinRankConnector(allowAll(), async (_url, init) => {
    submissions += 1;
    const body = JSON.parse(String(init?.body)) as {
      readonly tools_name: string;
      readonly data: { readonly queries: readonly string[] };
    };
    assert.equal(body.tools_name, "positions");
    assert.equal(body.data.queries.length, keywordCount);
    assert.equal(body.data.queries[0], "query 1");
    assert.equal(body.data.queries[keywordCount - 1], "query 15000");
    return json({ task_id: 3944 });
  });

  const result = await connector.submit(
    batchIntent,
    { apiKey: "private-key" },
    1_000
  );
  assert.equal(result.status, "ACCEPTED");
  assert.equal(submissions, 1);
});

test("keeps queued Check Top tasks pending before fetching their result", async () => {
  const responses = [
    json(
      {
        status: "Error",
        code: "429",
        error: "Too Many Requests",
        task_id: "3944"
      },
      429,
      { "Retry-After": "15" }
    ),
    json({ code: "TASK_STATUS", status: "queue" }),
    json({ code: "TASK_STATUS", status: "waiting", progress: "0%" }),
    json({ code: "TASK_STATUS", status: "process", progress: "50%" }),
    json({ code: "TASK_STATUS", status: "finish", progress: "100%" }),
    json(checkTopResultBody())
  ];
  const calledUrls: string[] = [];
  let permits = 0;
  const connector = new ArsenkinRankConnector({
    async tryAcquire() {
      permits += 1;
      return { allowed: true };
    }
  }, async (url, init) => {
    calledUrls.push(String(url));
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { task_id: "3944" });
    const response = responses.shift();
    assert.ok(response);
    return response;
  });

  assert.deepEqual(
    await connector.fetchResult(
      "3944",
      { apiKey: "private-key" },
      1_000
    ),
    {
      status: "RETRYABLE_FAILURE",
      code: "PROVIDER_RATE_LIMITED",
      retryAfterSeconds: 15
    }
  );
  assert.deepEqual(
    await connector.fetchResult(
      "3944",
      { apiKey: "private-key" },
      1_000
    ),
    { status: "PENDING" }
  );
  assert.deepEqual(
    await connector.fetchResult(
      "3944",
      { apiKey: "private-key" },
      1_000
    ),
    { status: "PENDING" }
  );
  assert.deepEqual(
    await connector.fetchResult(
      "3944",
      { apiKey: "private-key" },
      1_000
    ),
    { status: "PENDING" }
  );
  const ready = await connector.fetchResult(
    "3944",
    { apiKey: "private-key" },
    1_000
  );
  assert.equal(ready.status, "READY");
  if (ready.status !== "READY") assert.fail("Expected a ready Check Top result");
  const normalized = normalizeArsenkinRankResult(
    ready.value,
    "3944",
    competitorIntent(false)
  );
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0]?.serpResults?.length, 2);
  assert.deepEqual(calledUrls, [
    "https://arsenkin.ru/api/tools/check",
    "https://arsenkin.ru/api/tools/check",
    "https://arsenkin.ru/api/tools/check",
    "https://arsenkin.ru/api/tools/check",
    "https://arsenkin.ru/api/tools/check",
    "https://arsenkin.ru/api/tools/get"
  ]);
  assert.equal(permits, 6);
});

test("does not fetch rank result without a second shared HTTP permit", async () => {
  let permits = 0;
  const calledUrls: string[] = [];
  const connector = new ArsenkinRankConnector({
    async tryAcquire() {
      permits += 1;
      return permits === 1
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: 8 };
    }
  }, async (url) => {
    calledUrls.push(String(url));
    return json({ code: "TASK_STATUS", status: "finish", progress: 100 });
  });

  assert.deepEqual(
    await connector.fetchResult(
      "3944",
      { apiKey: "private-key" },
      1_000
    ),
    {
      status: "RETRYABLE_FAILURE",
      code: "PROVIDER_RATE_LIMITED",
      retryAfterSeconds: 8
    }
  );
  assert.deepEqual(calledUrls, ["https://arsenkin.ru/api/tools/check"]);
});

test("does not fetch a premature TASK_RESULT before check reaches finish/100", async () => {
  let calls = 0;
  const connector = new ArsenkinRankConnector(allowAll(), async (url) => {
    calls += 1;
    assert.equal(String(url), "https://arsenkin.ru/api/tools/check");
    return json({ code: "TASK_STATUS", status: "process", progress: 99 });
  });

  assert.deepEqual(
    await connector.fetchResult(
      "3944",
      { apiKey: "private-key" },
      1_000
    ),
    { status: "PENDING" }
  );
  assert.equal(calls, 1);
});

test("fails closed on undocumented or inconsistent check states", async () => {
  const responses = [
    json({ code: "TASK_STATUS", status: "finish", progress: 99 }),
    json({ code: "TASK_STATUS", status: "process", progress: 100 }),
    json({ code: "TASK_STATUS", status: "finish", progress: "done" })
  ];
  const connector = new ArsenkinRankConnector(allowAll(), async (url) => {
    assert.equal(String(url), "https://arsenkin.ru/api/tools/check");
    const response = responses.shift();
    assert.ok(response);
    return response;
  });

  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(
      await connector.fetchResult(
        "3944",
        { apiKey: "private-key" },
        1_000
      ),
      { status: "REJECTED", code: "INVALID_PROVIDER_RESPONSE" }
    );
  }
});

test("derives one found and one not-found result from a sealed positions fixture", () => {
  assert.deepEqual(
    normalizeArsenkinRankResult(resultBody(), "3944", intent()),
    [
      {
        manifestEntryId: ids.firstEntryId,
        keywordId: ids.firstKeywordId,
        found: true,
        position: 2,
        rankingUrl: "HTTPS://WWW.Example.COM:443/catalog#result",
        normalizedRankingUrl: "https://www.example.com/catalog",
        resultType: "ORGANIC",
        serpFeatures: [],
        serpResults: [{
          position: 2,
          rankingUrl: "HTTPS://WWW.Example.COM:443/catalog#result",
          normalizedRankingUrl: "https://www.example.com/catalog"
        }],
        dataQualityFlags: [
          "ABSOLUTE_POSITION_UNAVAILABLE",
          "PIXEL_POSITION_UNAVAILABLE",
          "TITLE_UNAVAILABLE",
          "SNIPPET_UNAVAILABLE"
        ]
      },
      {
        manifestEntryId: ids.secondEntryId,
        keywordId: ids.secondKeywordId,
        found: false,
        position: null,
        dataQualityFlags: []
      }
    ]
  );
  const staged = stageArsenkinRankResult(
    resultBody(),
    "3944",
    intent(),
    "2026-07-30T12:00:00.000Z"
  );
  assert.equal(staged.snapshot.schemaVersion, "arsenkin-rank-result@1");
  assert.equal(staged.snapshot.providerRequestId, "3944");
  assert.equal(staged.hash.algorithm, "SHA_256");
  assert.match(staged.hash.value, /^[a-f0-9]{64}$/u);
  assert.equal(
    arsenkinRankWireRequestHash(buildArsenkinRankWireRequest(intent()))
      .algorithm,
    "SHA_256"
  );
});

test("projects Arsenkin top20 rows into normalized SERP evidence", () => {
  const value = resultBody();
  value.result.table["купить диван"]!.top20 = JSON.stringify([
    {
      position: 1,
      url: "https://competitor.example/one",
      title: " Первый конкурент ",
      description: "Описание первого результата",
      favicon: "https://search-assets.example/icons/competitor.png"
    },
    {
      position: 2,
      url: "HTTPS://WWW.Example.COM:443/catalog#result",
      title: "Каталог",
      snippet: "Купить диван"
    },
    "https://competitor.example/three"
  ]);

  const result = normalizeArsenkinRankResult(value, "3944", intent())[0];
  assert.ok(result?.found);
  if (!result?.found) return;
  assert.equal(result.title, "Каталог");
  assert.equal(result.snippet, "Купить диван");
  assert.deepEqual(result.serpResults, [
    {
      position: 1,
      rankingUrl: "https://competitor.example/one",
      normalizedRankingUrl: "https://competitor.example/one",
      faviconUrl: "https://search-assets.example/icons/competitor.png",
      title: "Первый конкурент",
      snippet: "Описание первого результата"
    },
    {
      position: 2,
      rankingUrl: "HTTPS://WWW.Example.COM:443/catalog#result",
      normalizedRankingUrl: "https://www.example.com/catalog",
      title: "Каталог",
      snippet: "Купить диван"
    },
    {
      position: 3,
      rankingUrl: "https://competitor.example/three",
      normalizedRankingUrl: "https://competitor.example/three"
    }
  ]);
  assert.deepEqual(result.dataQualityFlags, [
    "ABSOLUTE_POSITION_UNAVAILABLE",
    "PIXEL_POSITION_UNAVAILABLE"
  ]);
});

test("accepts a provider-supported TOP-100 position at the sealed depth", () => {
  const top100Intent = intent({
    execution: {
      ...intent().execution,
      depth: 100
    }
  });
  const results = normalizeArsenkinRankResult(
    resultBody(100),
    "3944",
    top100Intent
  );
  assert.equal(results[0]?.position, 100);
});

test("applies exact URL matching and rejects unbound or malformed provider data", () => {
  const exactUrlIntent = intent({
    execution: {
      ...intent().execution,
      domainMatchRule: {
        mode: "SPECIFIC_URL",
        value: "https://www.example.com/catalog"
      }
    }
  });
  assert.equal(
    normalizeArsenkinRankResult(
      resultBody(),
      "3944",
      exactUrlIntent
    )[0]?.found,
    true
  );

  const wrongTask = { ...resultBody(), task_id: "other-task" };
  assert.throws(
    () => normalizeArsenkinRankResult(wrongTask, "3944", intent()),
    /Invalid Arsenkin rank provider response/u
  );
  const missingQuery = resultBody();
  delete missingQuery.result.table["купить диван"];
  assert.throws(
    () => normalizeArsenkinRankResult(missingQuery, "3944", intent()),
    /Invalid Arsenkin rank provider response/u
  );
  const legacyCheckTopEcho = resultBody();
  (legacyCheckTopEcho as { result: unknown }).result = {
    request: { queries: ["купить диван", "seo audit"] },
    result: { collect: [] }
  };
  assert.throws(
    () => normalizeArsenkinRankResult(legacyCheckTopEcho, "3944", intent()),
    /Invalid Arsenkin rank provider response/u
  );
  const unknownPositionsShape = resultBody();
  (unknownPositionsShape as { result: unknown }).result = {
    rows: [{ query: "купить диван", position: 2, url: "https://example.com/" }]
  };
  assert.throws(
    () => normalizeArsenkinRankResult(unknownPositionsShape, "3944", intent()),
    /Invalid Arsenkin rank provider response/u
  );
  const foreignUrl = resultBody();
  foreignUrl.result.table["купить диван"] = {
    commerce: [false],
    position: [2],
    top20: "[]",
    url: "https://foreign.example/page"
  };
  assert.throws(
    () => normalizeArsenkinRankResult(foreignUrl, "3944", intent()),
    /Invalid Arsenkin rank provider response/u
  );
  const malformedNotFound = resultBody();
  malformedNotFound.result.table["seo audit"] = {
    position: [1_001],
    top20: "[]",
    url: "https://example.com/must-not-exist"
  };
  assert.throws(
    () => normalizeArsenkinRankResult(malformedNotFound, "3944", intent()),
    /Invalid Arsenkin rank provider response/u
  );
  assert.throws(
    () =>
      buildArsenkinRankWireRequest(
        intent({
          execution: {
            ...intent().execution,
            regionCode: "US-NY"
          }
        })
      ),
    /numeric search region id/u
  );
});

function intent(
  overrides: Partial<RankProviderRequestIntentV1> = {}
): RankProviderRequestIntentV1 {
  const base: RankProviderRequestIntentV1 = {
    schemaVersion: "rank-provider-request-intent@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    jobItemId: ids.jobItemId,
    estimateId: ids.estimateId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: { domain: "example.com", version: 1 },
    execution: {
      searchEngine: "GOOGLE",
      countryCode: "RU",
      regionCode: "1011969",
      language: "ru",
      device: "DESKTOP",
      depth: 30,
      domainMatchRule: { mode: "INCLUDE_WWW" },
      safeSearch: false,
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE",
      providerMappingVersion: "arsenkin-positions@1"
    },
    manifest: {
      id: ids.manifestId,
      hashSchemaVersion: "rank-manifest@1",
      manifestHash: hash("a"),
      pairCount: "2"
    },
    manifestChunk: {
      manifestId: ids.manifestId,
      chunkIndex: 0,
      hashSchemaVersion: "rank-manifest-chunk@1",
      chunkHash: hash("b")
    },
    executionConnectorVersion: "arsenkin-positions@2.0.0",
    providerPolicyVersion: "manual-arsenkin-positions@1.0.0",
    keywords: [
      {
        manifestEntryId: ids.firstEntryId,
        sequence: 0,
        keywordId: ids.firstKeywordId,
        keywordText: "купить диван",
        keywordTextHash: {
          algorithm: "SHA_256",
          value: utf8Sha256("купить диван")
        },
        language: "ru"
      },
      {
        manifestEntryId: ids.secondEntryId,
        sequence: 1,
        keywordId: ids.secondKeywordId,
        keywordText: "seo audit",
        keywordTextHash: {
          algorithm: "SHA_256",
          value: utf8Sha256("seo audit")
        },
        language: "en"
      }
    ]
  };
  return { ...base, ...overrides };
}

function competitorIntent(
  saveProjectPosition: boolean
): RankProviderRequestIntentV1 {
  const base = intent();
  return intent({
    execution: {
      ...base.execution,
      purpose: "COMPETITOR_SERP",
      saveProjectPosition,
      providerMappingVersion: "arsenkin-check-top-google-live@1"
    }
  });
}

function checkTopResultBody(): unknown {
  return {
    code: "TASK_RESULT",
    task_id: "3944",
    result: {
      request: {
        queries: ["купить диван", "seo audit"],
        depth: 10,
        ss: [{ ss: 11, region: 1011969 }],
        is_snippet: true,
        is_noreask: false
      },
      result: {
        collect: [[
          [
            "https://competitor.example/one",
            "https://www.example.com/catalog"
          ],
          ["https://competitor.example/audit"]
        ]],
        snippets: {
          "https://competitor.example/one": [
            { title: "Конкурент", snippet: "Описание" }
          ],
          "https://www.example.com/catalog": {
            "1": { title: "Каталог", snippet: "Наш результат" }
          }
        }
      }
    }
  };
}

function resultBody(position = 2): {
  task_id: string;
  code: string;
  result: {
    table: Record<string, Record<string, unknown>>;
    summary: Record<string, unknown>;
    format: number;
  };
  created_at: string;
  finished_at: string;
} {
  return {
    code: "TASK_RESULT",
    task_id: "3944",
    result: {
      table: {
        "купить диван": {
          commerce: [false],
          position: [position],
          top20: "[]",
          url: "HTTPS://WWW.Example.COM:443/catalog#result"
        },
        "seo audit": {
          position: [1_001],
          top20: "[]"
        }
      },
      summary: {},
      format: 0
    },
    created_at: "2026-08-02 12:00:00",
    finished_at: "2026-08-02 12:01:00"
  };
}

function keywordEntries(count: number): RankProviderRequestIntentV1["keywords"] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    const keywordText = `query ${index + 1}`;
    return {
      manifestEntryId: `01910000-0000-7000-8000-${suffix}`,
      sequence: index,
      keywordId: `01920000-0000-7000-8000-${suffix}`,
      keywordText,
      keywordTextHash: {
        algorithm: "SHA_256",
        value: utf8Sha256(keywordText)
      },
      language: "ru"
    };
  });
}

function hash(character: string): {
  readonly algorithm: "SHA_256";
  readonly value: string;
} {
  return {
    algorithm: "SHA_256",
    value: character.repeat(64)
  };
}

function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function allowAll(): ArsenkinHttpRateLimitGate {
  return {
    async tryAcquire() {
      return { allowed: true };
    }
  };
}
