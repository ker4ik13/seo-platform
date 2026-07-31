import assert from "node:assert/strict";
import test from "node:test";
import { utf8Sha256 } from "@seo-platform/contracts/canonical-json";
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

test("builds the documented check-top payload with exact query order", () => {
  const request = buildArsenkinRankWireRequest(intent());
  assert.deepEqual(request, {
    tools_name: "check-top",
    data: {
      queries: ["купить диван", "seo audit"],
      is_snippet: false,
      noreask: false,
      se: [{ type: 11, region: 1011969 }],
      depth: 30
    }
  });
  assert.deepEqual(
    buildArsenkinRankWireRequest(
      intent({ execution: { ...intent().execution, device: "MOBILE" } })
    ).data.se,
    [{ type: 12, region: 1011969 }]
  );
});

test("submits only through POST with Bearer auth and keeps transport ambiguity explicit", async () => {
  let called = false;
  const connector = new ArsenkinRankConnector(async (url, init) => {
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
    await connector.submit(intent(), { apiKey: "private-key" }, 1_000),
    {
      status: "ACCEPTED",
      taskId: "3944",
      request: buildArsenkinRankWireRequest(intent())
    }
  );
  assert.equal(called, true);

  const ambiguous = new ArsenkinRankConnector(async () => {
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

test("normalizes provider throttling and bounded pending/result polling", async () => {
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
    json({ code: "TASK_RUNNING", task_id: "3944" }),
    json(resultBody())
  ];
  const connector = new ArsenkinRankConnector(async (url, init) => {
    assert.equal(String(url), "https://arsenkin.ru/api/tools/get");
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
  const ready = await connector.fetchResult(
    "3944",
    { apiKey: "private-key" },
    1_000
  );
  assert.equal(ready.status, "READY");
});

test("derives one found and one not-found result from the documented matrix", () => {
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
  const wrongEcho = resultBody();
  (
    wrongEcho.result.request as { queries: string[] }
  ).queries = ["another query", "seo audit"];
  assert.throws(
    () => normalizeArsenkinRankResult(wrongEcho, "3944", intent()),
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
    /numeric Google region id/u
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
    executionConnectorVersion: "arsenkin-positions@1.0.0",
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

function resultBody(): {
  task_id: string;
  code: string;
  result: {
    request: {
      queries: string[];
      depth: number;
      ss: { ss: number; region: number }[];
    };
    result: { collect: string[][][] };
  };
} {
  return {
    code: "TASK_RESULT",
    task_id: "3944",
    result: {
      request: {
        queries: ["купить диван", "seo audit"],
        depth: 30,
        ss: [{ ss: 11, region: 1011969 }]
      },
      result: {
        collect: [
          [
            [
              "https://competitor.example/",
              "HTTPS://WWW.Example.COM:443/catalog#result"
            ],
            ["https://competitor.example/a"]
          ]
        ]
      }
    }
  };
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
