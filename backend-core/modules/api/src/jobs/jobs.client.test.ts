import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { JobsClient } from "./jobs.client.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const actorId = "01900000-0000-7000-8000-000000000002";
const credentialId = "01900000-0000-7000-8000-000000000003";
const validationId = "01900000-0000-7000-8000-000000000004";
const projectId = "01900000-0000-7000-8000-000000000005";
const bindingId = "01900000-0000-7000-8000-000000000006";
const routeId = "01900000-0000-7000-8000-000000000007";
const crawlId = "01900000-0000-7000-8000-000000000008";
const crawlJobId = "01900000-0000-7000-8000-000000000009";
const destinationWorkspaceId = "01900000-0000-7000-8000-000000000010";

test("creates a Wordstat research run through the credential boundary", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedHeaders = new Headers(init?.headers);
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return dataResponse({
      id: crawlJobId,
      workspaceId,
      projectId,
      source: "XMLSTOCK_WORDSTAT",
      provider: "XMLSTOCK",
      regionCode: "225",
      device: "ALL",
      seedCount: 1,
      includeRightColumn: true,
      maxKeywords: 5_000,
      status: "QUEUED",
      collectedKeywords: 0,
      selectedKeywords: 0,
      importedKeywords: 0,
      rows: [],
      version: 1,
      createdAt: "2026-08-26T12:00:00.000Z",
      updatedAt: "2026-08-26T12:00:00.000Z"
    });
  }) as typeof fetch;

  try {
    const result = await client().createKeywordResearchRun(
      projectContext("request-wordstat-create-001"),
      {
        source: "XMLSTOCK_WORDSTAT",
        queries: ["нейросети"],
        regionCode: "225",
        device: "ALL",
        minusWords: [],
        clearMinusPhrases: false,
        includeRightColumn: true,
        clearPlus: false,
        maxKeywords: 5_000
      },
      "wordstat-create-001",
      { planCode: "TRIAL", planVersion: 1, concurrentJobs: 1 }
    );

    assert.equal(result.status, "QUEUED");
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/keyword-research-runs`
    );
    assert.equal(
      capturedHeaders?.get("x-internal-token"),
      "c".repeat(32)
    );
    assert.equal(capturedHeaders?.get("idempotency-key"), "wordstat-create-001");
    assert.equal(capturedBody?.workspaceId, workspaceId);
    assert.equal(capturedBody?.projectId, projectId);
    assert.equal(capturedBody?.actorId, actorId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loads the next immutable page of parsed Wordstat queries", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    return dataResponse({
      rows: [{
        id: validationId,
        ordinal: 501,
        keyword: "нейросети бесплатно",
        frequencyBase: 877330,
        sourceQuery: "нейросети",
        sourceColumn: "LEFT",
        selected: true
      }],
      page: { hasNext: false }
    });
  }) as typeof fetch;

  try {
    const page = await client().getKeywordResearchRows(
      projectContext("request-wordstat-rows-001"),
      crawlJobId,
      { cursor: 500, limit: 200 }
    );
    assert.equal(page.rows[0]?.ordinal, 501);
    assert.equal(page.page.hasNext, false);
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/keyword-research-runs/${crawlJobId}/rows`
    );
    assert.equal(capturedUrl?.searchParams.get("cursor"), "500");
    assert.equal(capturedUrl?.searchParams.get("limit"), "200");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creates a frequency collection through the general Jobs boundary", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedHeaders = new Headers(init?.headers);
    return dataResponse({
      id: crawlJobId,
      workspaceId,
      projectId,
      provider: "XMLSTOCK",
      status: "QUEUED",
      selectedKeywords: 1,
      completedKeywords: 0,
      failedKeywords: 0,
      types: ["BASE"],
      regionCode: "225",
      device: "ALL",
      version: 1,
      createdAt: "2026-08-27T10:00:00.000Z",
      updatedAt: "2026-08-27T10:00:00.000Z"
    });
  }) as typeof fetch;

  try {
    const result = await client().createFrequencyCollection(
      projectContext("request-frequency-create-001"),
      {
        items: [{ id: validationId, version: 1 }],
        types: ["BASE"],
        regionCode: "225",
        device: "ALL"
      },
      "frequency-create-001",
      { planCode: "TRIAL", planVersion: 1, concurrentJobs: 1 }
    );

    assert.equal(result.status, "QUEUED");
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/frequency-collections`
    );
    assert.equal(capturedHeaders?.get("x-internal-token"), "i".repeat(32));
    assert.equal(
      capturedHeaders?.get("idempotency-key"),
      "frequency-create-001"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loads one bounded active-operation count collection for a workspace", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { readonly url: URL; readonly headers: Headers } | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    captured = {
      url: new URL(input instanceof Request ? input.url : input.toString()),
      headers: new Headers(init?.headers)
    };
    return dataResponse({
      projects: [
        { projectId, activeOperationCount: 3 },
        { projectId: destinationWorkspaceId, activeOperationCount: 1 }
      ]
    });
  }) as typeof fetch;

  try {
    const counts = await client().listProjectOperationActivity(
      context("request-operation-activity-001")
    );
    assert.deepEqual([...counts], [
      [projectId, 3],
      [destinationWorkspaceId, 1]
    ]);
    assert.equal(
      captured?.url.pathname,
      `/internal/v1/workspaces/${workspaceId}/operation-activity`
    );
    assert.equal(captured?.headers.get("x-project-id"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dismisses one failed project operation through the tenant-bound Jobs route", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { readonly url: URL; readonly method: string | undefined; readonly headers: Headers } | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    captured = {
      url: new URL(input instanceof Request ? input.url : input.toString()),
      method: init?.method,
      headers: new Headers(init?.headers)
    };
    return dataResponse({
      operationId: crawlJobId,
      dismissedAt: "2026-09-11T12:45:00.000Z"
    });
  }) as typeof fetch;

  try {
    assert.deepEqual(
      await client().dismissProjectOperation(
        projectContext("request-operation-dismiss-001"),
        crawlJobId
      ),
      {
        operationId: crawlJobId,
        dismissedAt: "2026-09-11T12:45:00.000Z"
      }
    );
    assert.equal(captured?.method, "DELETE");
    assert.equal(
      captured?.url.pathname,
      `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/operations/${crawlJobId}`
    );
    assert.equal(captured?.headers.get("x-project-id"), projectId);
    assert.equal(captured?.headers.get("x-actor-id"), actorId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cancels a frequency collection without forwarding a stale UI version", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return dataResponse({
      id: crawlJobId,
      workspaceId,
      projectId,
      provider: "ARSENKIN",
      status: "CANCELLED",
      selectedKeywords: 2_002,
      completedKeywords: 137,
      failedKeywords: 0,
      types: ["BASE", "EXACT", "FIXED"],
      regionCode: "213",
      device: "ALL",
      version: 42,
      createdAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:01:00.000Z",
      finishedAt: "2026-08-12T10:01:00.000Z"
    });
  }) as typeof fetch;

  try {
    const result = await client().cancelFrequencyCollection(
      projectContext("request-frequency-cancel-001"),
      crawlJobId
    );

    assert.equal(result.status, "CANCELLED");
    assert.deepEqual(capturedBody, {
      workspaceId,
      projectId,
      actorId
    });
    assert.equal("version" in (capturedBody ?? {}), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loads a safe global operation page for platform administration", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { readonly url: URL; readonly headers: Headers } | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    captured = {
      url: new URL(input instanceof Request ? input.url : input.toString()),
      headers: new Headers(init?.headers)
    };
    return dataResponse({
      data: [{
        id: crawlJobId,
        workspaceId,
        projectId,
        actorId,
        type: "MANUAL_RANK_CHECK",
        status: "RUNNING",
        stage: "COLLECTING",
        provider: "XMLSTOCK",
        searchEngine: "YANDEX",
        searchSource: "LIVE",
        connection: { label: "Личный", displayHint: "••••b313" },
        workers: [{ name: "Офисный воркер", activeTasks: 4, nodeId: crawlJobId, status: "ONLINE", assignedOperations: 2 }],
        progress: { current: "17", total: "50", unit: "KEYWORDS" },
        result: { found: 12, notFound: 5 },
        attempt: 1,
        maxAttempts: 8,
        createdAt: "2026-08-11T18:00:00.000Z",
        startedAt: "2026-08-11T18:00:01.000Z",
        updatedAt: "2026-08-11T18:00:10.000Z"
      }],
      totals: { total: 9, active: 2, completed: 6, attention: 1 },
      types: [{ type: "MANUAL_RANK_CHECK", count: 9 }]
    });
  }) as typeof fetch;

  try {
    const result = await client().listAdminOperations(
      actorId,
      "request-admin-operations-001",
      { statusGroup: "ACTIVE", type: "MANUAL_RANK_CHECK", limit: 50 }
    );
    assert.equal(result.data[0]?.result.found, 12);
    assert.equal(result.data[0]?.searchEngine, "YANDEX");
    assert.equal(result.data[0]?.searchSource, "LIVE");
    assert.deepEqual(result.data[0]?.connection,
      { label: "Личный", displayHint: "••••b313" });
    assert.deepEqual(result.data[0]?.workers,
      [{ name: "Офисный воркер", activeTasks: 4, nodeId: crawlJobId, status: "ONLINE", assignedOperations: 2 }]);
    assert.equal(
      captured?.url.pathname,
      "/internal/v1/platform-admin/operations"
    );
    assert.equal(captured?.url.searchParams.get("status"), "ACTIVE");
    assert.equal(captured?.url.searchParams.get("type"), "MANUAL_RANK_CHECK");
    assert.equal(captured?.headers.get("x-actor-id"), actorId);
    assert.equal(captured?.headers.get("x-internal-token"), "i".repeat(32));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loads tenant-scoped rank source usage without accepting API keys", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    capturedUrl = new URL(input instanceof Request ? input.url : input.toString());
    return dataResponse({
      workspaceId, projectId, jobId: crawlJobId,
      sources: [{ provider: "XMLSTOCK", label: "Личный",
        displayHint: "••••b313", requestCount: "4", selected: true }]
    });
  }) as typeof fetch;
  try {
    const result = await client().getRankOperationSources(
      projectContext("rank-source-request-001"), crawlJobId
    );
    assert.equal(result.sources[0]?.label, "Личный");
    assert.equal(capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/jobs/${crawlJobId}/sources`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loads one safe platform operation for an admin deep link", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    return dataResponse({
      id: crawlJobId,
      workspaceId,
      projectId,
      actorId,
      type: "MANUAL_RANK_CHECK",
      status: "RUNNING",
      stage: "WAITING_EXECUTION_GRANT",
      provider: "XMLSTOCK",
      progress: { current: "17", total: "50", unit: "KEYWORDS" },
      result: { found: 12, notFound: 5 },
      attempt: 1,
      maxAttempts: 8,
      createdAt: "2026-08-11T18:00:00.000Z",
      startedAt: "2026-08-11T18:00:01.000Z",
      updatedAt: "2026-08-11T18:00:10.000Z"
    });
  }) as typeof fetch;

  try {
    const result = await client().getAdminOperation(
      actorId,
      "request-admin-operation-detail-001",
      crawlJobId
    );
    assert.equal(result.id, crawlJobId);
    assert.equal(result.result.found, 12);
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/platform-admin/operations/${crawlJobId}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards only a bounded Arsenkin task percentage through the admin client", async () => {
  const originalFetch = globalThis.fetch;
  let providerProgressPercent = 87;
  globalThis.fetch = (async (): Promise<Response> => dataResponse({
    id: crawlJobId,
    workspaceId,
    projectId,
    actorId,
    type: "AI_ANSWER_COLLECTION",
    status: "RETRY_SCHEDULED",
    stage: "provider_poll",
    provider: "ARSENKIN",
    progress: { current: "0", total: "110", unit: "KEYWORDS" },
    providerProgressPercent,
    result: {},
    attempt: 17,
    maxAttempts: 720,
    createdAt: "2026-10-07T07:13:19.000Z",
    updatedAt: "2026-10-07T07:36:54.000Z"
  })) as typeof fetch;
  try {
    assert.equal((await client().getAdminOperation(actorId, "request-provider-progress", crawlJobId)).providerProgressPercent, 87);
    providerProgressPercent = 101;
    await assert.rejects(() => client().getAdminOperation(actorId, "request-provider-progress-invalid", crawlJobId), DomainError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker-node admin client validates the one-time secret and scoped mutations", async () => {
  const originalFetch = globalThis.fetch;
  const id = "01900000-0000-7000-8000-000000000099";
  const token = `wn_${"a".repeat(43)}`;
  const node = {
    id, name: "office-one", enabled: false, draining: false,
    capabilities: ["RANK"], maxHttpSlots: 16, maxCpuSlots: 2,
    reportedHttpSlots: 0, reportedRankSlots: 0, reportedCpuSlots: 0,
    reportedMemoryBytes: "0", activeWorkItems: 0,
    reportedBuildHash: "a".repeat(64), expectedBuildHash: "b".repeat(64),
    online: false, lastHeartbeatAt: null, protocolVersion: null
  };
  const captured: Array<{ method: string; path: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      method: init?.method ?? "GET",
      path: new URL(input instanceof Request ? input.url : input.toString()).pathname,
      ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {})
    });
    return dataResponse(captured.length === 1 ? [node] :
      captured.length === 2 ? { node, token } : { ...node, enabled: true });
  }) as typeof fetch;
  try {
    const jobs = client();
    const listed = (await jobs.listWorkerNodes(actorId, "list-workers"))[0];
    assert.equal(listed?.id, id);
    assert.equal(listed?.reportedBuildHash, "a".repeat(64));
    assert.equal(listed?.expectedBuildHash, "b".repeat(64));
    assert.equal((await jobs.createWorkerNode(actorId, "create-worker", {
      name: "office-one", capabilities: ["RANK"], maxHttpSlots: 16, maxCpuSlots: 2
    })).token, token);
    assert.equal((await jobs.updateWorkerNode(
      actorId, "enable-worker", id, "enabled", { enabled: true }
    )).enabled, true);
    assert.deepEqual(captured.map(({ method, path }) => [method, path]), [
      ["GET", "/internal/v1/platform-admin/worker-nodes"],
      ["POST", "/internal/v1/platform-admin/worker-nodes"],
      ["PATCH", `/internal/v1/platform-admin/worker-nodes/${id}/enabled`]
    ]);
    assert.deepEqual(captured[2]?.body, { enabled: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards only the trusted storage entitlement with an upload command", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return dataResponse({});
  }) as typeof fetch;

  try {
    await client().createUpload(
      projectContext("request-upload-001"),
      {
        fileName: "keywords.csv",
        mediaType: "text/csv",
        sizeBytes: "1024"
      },
      "upload-command-001",
      {
        planCode: "TRIAL",
        planVersion: 1,
        storageBytes: 536_870_912
      }
    );

    assert.deepEqual(capturedBody?.entitlement, {
      planCode: "TRIAL",
      planVersion: 1,
      storageBytes: 536_870_912
    });
    assert.equal(capturedBody?.workspaceId, workspaceId);
    assert.equal(capturedBody?.projectId, projectId);
    assert.equal(capturedBody?.actorId, actorId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves a Jobs storage capacity rejection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        error: {
          code: "QUOTA_EXCEEDED",
          message: "unsafe upstream message"
        }
      }),
      {
        status: 409,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().createUpload(
        projectContext("request-upload-quota-001"),
        {
          fileName: "keywords.csv",
          mediaType: "text/csv",
          sizeBytes: "1024"
        },
        "upload-command-quota-001",
        {
          planCode: "TRIAL",
          planVersion: 1,
          storageBytes: 536_870_912
        }
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "QUOTA_EXCEEDED" &&
        !error.message.includes("unsafe")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps active operations distinguishable during project transfer reset", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        code: "PROJECT_TRANSFER_ACTIVE_OPERATIONS",
        message: "unsafe operation details"
      }),
      {
        status: 409,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().resetProjectForWorkspaceTransfer(
        {
          workspaceId,
          projectId,
          actorId,
          destinationWorkspaceId
        },
        "request-project-transfer-reset-001"
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "RESOURCE_STATE_CONFLICT" &&
        error.details?.reason === "ACTIVE_OPERATIONS" &&
        !error.message.includes("unsafe")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gets one tenant-scoped technical crawl through its public locator", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (
    input: string | URL | Request
  ): Promise<Response> => {
    requestedUrl = String(input);
    return dataResponse(crawlResponseData({
      startedAt: "2026-07-31T05:01:00.000Z"
    }));
  }) as typeof fetch;

  try {
    const crawl = await client().getTechnicalCrawl(
      projectContext("request-crawl-get-001"),
      crawlId
    );
    assert.equal(crawl.id, crawlId);
    assert.equal(crawl.status, "QUEUED");
    assert.equal(crawl.startedAt, "2026-07-31T05:01:00.000Z");
    assert.match(
      requestedUrl,
      new RegExp(`/projects/${projectId}/crawls/${crawlId}$`, "u")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("upgrades a rolling legacy crawl response with safe scope defaults", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    dataResponse(crawlResponseData({
      config: {
        startUrls: ["https://example.com/"],
        maxUrls: 100,
        maxDepth: 3,
        requestsPerMinute: 30,
        obeyRobots: true
      }
    }))) as typeof fetch;

  try {
    const crawl = await client().getTechnicalCrawl(
      projectContext("request-crawl-legacy-001"),
      crawlId
    );
    assert.deepEqual(crawl.config, {
      purpose: "TECHNICAL_AUDIT",
      startUrls: ["https://example.com/"],
      sitemapUrls: [],
      includePatterns: [],
      excludePatterns: [],
      queryPolicy: "DROP_TRACKING",
      maxUrls: 100,
      maxDepth: 3,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 30,
      obeyRobots: true,
      savePageMap: true
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts explicit homepage redirect checks from the execution service", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    dataResponse(crawlResponseData({
      config: {
        purpose: "HTTP_STATUS_CHECK",
        startUrls: ["https://example.com/"],
        homepageChecks: [
          "HTTP_TO_HTTPS",
          "WWW_CANONICAL",
          "MULTIPLE_SLASHES"
        ],
        sitemapUrls: [],
        includePatterns: [],
        excludePatterns: [],
        queryPolicy: "DROP_TRACKING",
        maxUrls: 100,
        maxDepth: 0,
        maxRuntimeSeconds: 3_600,
        requestsPerMinute: 30,
        obeyRobots: true,
        savePageMap: true
      },
      discoveredUrls: 7
    }))) as typeof fetch;

  try {
    const crawl = await client().getTechnicalCrawl(
      projectContext("request-crawl-homepage-checks-001"),
      crawlId
    );
    assert.deepEqual(crawl.config.homepageChecks, [
      "HTTP_TO_HTTPS",
      "WWW_CANONICAL",
      "MULTIPLE_SLASHES"
    ]);
    assert.equal(crawl.discoveredUrls, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves a disabled Page Map projection from the execution service", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    dataResponse(crawlResponseData({
      config: {
        ...crawlResponseData().config as object,
        savePageMap: false
      }
    }))) as typeof fetch;

  try {
    const crawl = await client().getTechnicalCrawl(
      projectContext("request-crawl-page-map-disabled-001"),
      crawlId
    );
    assert.equal(crawl.config.savePageMap, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts only a bounded queued host backoff projection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    dataResponse(crawlResponseData({
      backoffCode: "SITE_PAUSED",
      backoffUntil: "2026-08-01T05:05:00.000Z"
    }))) as typeof fetch;
  try {
    const crawl = await client().getTechnicalCrawl(
      projectContext("request-crawl-backoff-001"),
      crawlId
    );
    assert.equal(crawl.backoffCode, "SITE_PAUSED");
    assert.equal(
      crawl.backoffUntil,
      "2026-08-01T05:05:00.000Z"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects secret-bearing or contradictory technical crawl responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [
      crawlResponseData({
        config: {
          ...crawlResponseData().config as object,
          startUrls: ["https://user:secret@example.com/"]
        }
      }),
      crawlResponseData({
        config: {
          ...crawlResponseData().config as object,
          savePageMap: "yes"
        }
      }),
      crawlResponseData({
        status: "COMPLETED",
        finishedAt: "2026-07-31T06:00:00.000Z"
      }),
      crawlResponseData({
        status: "FAILED",
        finishedAt: "2026-07-31T06:00:00.000Z",
        failureCode: "SECRET_PROVIDER_ERROR"
      }),
      crawlResponseData({
        backoffCode: "HOST_RATE_LIMIT"
      }),
      crawlResponseData({
        status: "RUNNING",
        backoffCode: "HOST_UNAVAILABLE",
        backoffUntil: "2026-07-31T05:05:00.000Z"
      })
    ]) {
      globalThis.fetch = (async (): Promise<Response> =>
        dataResponse(response)) as typeof fetch;
      await assert.rejects(
        client().getTechnicalCrawl(
          projectContext("request-crawl-invalid-001"),
          crawlId
        ),
        (error: unknown) =>
          error instanceof DomainError &&
          error.code === "DEPENDENCY_UNAVAILABLE"
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards a credential idempotency key with trusted workspace context", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  let capturedHeaders: Headers | undefined;
  let capturedRedirect: RequestInit["redirect"];
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedHeaders = new Headers(init?.headers);
    capturedRedirect = init?.redirect;
    assert.equal(typeof init?.body, "string");
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return new Response(
      JSON.stringify({
        data: {
          id: credentialId,
          workspaceId,
          provider: "KEYS_SO",
          label: "Primary",
          mode: "BYOK_API_KEY",
          status: "PENDING_VERIFICATION",
          displayHint: "••••-key",
          capabilities: [
            "KEYWORD_RESEARCH",
            "COMPETITOR_RESEARCH",
            "SERP_COLLECTION"
          ],
          quota: {
            status: "AVAILABLE",
            unit: "API_REQUESTS",
            limit: 25_000,
            used: 40,
            remaining: 24_960,
            observedAt: "2026-07-29T09:00:00.000Z"
          },
          version: 1,
          createdAt: "2026-07-29T09:00:00.000Z",
          updatedAt: "2026-07-29T09:00:00.000Z"
        }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  }) as typeof fetch;

  try {
    const client = new JobsClient(
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_JOBS_TOKEN: "i".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
        JOBS_INTERNAL_URL: "http://jobs.test:4002"
      })
    );
    const result = await client.createIntegrationCredential(
      {
        tenant: {
          workspaceId,
          workspaceStatus: "ACTIVE",
          roleCode: "OWNER"
        },
        actorId,
        requestId: "request-jobs-001"
      },
      {
        provider: "KEYS_SO",
        label: "Primary",
        apiKey: "test-api-key"
      },
      "credential-create-001"
    );

    assert.equal(result.id, credentialId);
    assert.deepEqual(result.quota, {
      status: "AVAILABLE",
      unit: "API_REQUESTS",
      limit: 25_000,
      used: 40,
      remaining: 24_960,
      observedAt: "2026-07-29T09:00:00.000Z"
    });
    assert.equal(capturedBody?.workspaceId, workspaceId);
    assert.equal(capturedBody?.actorId, actorId);
    assert.equal(
      capturedBody?.idempotencyKey,
      "credential-create-001"
    );
    assert.equal(capturedHeaders?.get("x-workspace-id"), workspaceId);
    assert.equal(capturedHeaders?.get("x-project-id"), null);
    assert.equal(
      capturedHeaders?.get("x-internal-token"),
      "c".repeat(32)
    );
    assert.equal(capturedRedirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("enables platform credentials without forwarding provider secret material", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return new Response(
      JSON.stringify({
        data: {
          ...credentialResponseData(),
          provider: "XMLSTOCK",
          label: "XMLStock — внутренние токены",
          mode: "PLATFORM_PAID",
          displayHint: "Системный",
          capabilities: ["SERP_RANK_TRACKING"],
          quota: { status: "NOT_AVAILABLE" }
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await client().enablePlatformIntegrationCredential(
      context("request-platform-credential-001"),
      { provider: "XMLSTOCK" },
      "platform-credential-enable-001"
    );

    assert.equal(result.mode, "PLATFORM_PAID");
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/integrations/platform-credentials`
    );
    assert.deepEqual(capturedBody, {
      workspaceId,
      actorId,
      idempotencyKey: "platform-credential-enable-001",
      provider: "XMLSTOCK"
    });
    assert.equal(JSON.stringify(capturedBody).includes("apiKey"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves the authoritative current-material active validation in the credential list", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        data: [
          {
            ...credentialResponseData(),
            activeValidation: validationResponseData("RUNNING", {
              startedAt: "2026-07-29T09:00:01.000Z"
            })
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    const result = await client().listIntegrationCredentials(
      context("request-credential-list-001")
    );

    assert.equal(result[0]?.activeValidation?.id, validationId);
    assert.equal(result[0]?.activeValidation?.status, "RUNNING");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts the safe XMLStock account quota projection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        data: [
          {
            ...credentialResponseData(),
            provider: "XMLSTOCK",
            quota: {
              status: "AVAILABLE",
              unit: "XMLSTOCK_REQUESTS",
              remaining: 0,
              frozenRemaining: 0,
              usedToday: 4,
              usedMonth: 29,
              tariffDaysRemaining: 0,
              balance: {
                amount: "27.27",
                frozenAmount: "0",
                currency: "RUB"
              },
              observedAt: "2026-08-04T17:43:19.000Z"
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    const result = await client().listIntegrationCredentials(
      context("request-credential-list-xmlstock-001")
    );

    assert.deepEqual(result[0]?.quota, {
      status: "AVAILABLE",
      unit: "XMLSTOCK_REQUESTS",
      remaining: 0,
      frozenRemaining: 0,
      usedToday: 4,
      usedMonth: 29,
      tariffDaysRemaining: 0,
      balance: {
        amount: "27.27",
        frozenAmount: "0",
        currency: "RUB"
      },
      observedAt: "2026-08-04T17:43:19.000Z"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed XMLStock monetary quota metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        data: [
          {
            ...credentialResponseData(),
            provider: "XMLSTOCK",
            quota: {
              status: "AVAILABLE",
              unit: "XMLSTOCK_REQUESTS",
              remaining: 0,
              balance: {
                amount: "-10",
                currency: "RUB"
              }
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().listIntegrationCredentials(
        context("request-credential-list-xmlstock-invalid-001")
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 502 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a credential list validation outside the credential scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        data: [
          {
            ...credentialResponseData(),
            activeValidation: validationResponseData("QUEUED", {
              credentialId:
                "01900000-0000-7000-8000-000000000099"
            })
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().listIntegrationCredentials(
        context("request-credential-list-002")
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 502 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a terminal job exposed as an active credential validation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        data: [
          {
            ...credentialResponseData(),
            activeValidation: validationResponseData("SUCCEEDED", {
              finishedAt: "2026-07-29T09:00:02.000Z"
            })
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().listIntegrationCredentials(
        context("request-credential-list-003")
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 502 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creates a credential validation with an idempotent trusted command", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedMethod: string | undefined;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedMethod = init?.method;
    assert.equal(typeof init?.body, "string");
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return validationResponse("QUEUED");
  }) as typeof fetch;

  try {
    const result =
      await client().createIntegrationCredentialValidation(
        context("request-validation-create-001"),
        credentialId,
        "credential-validation-001"
      );

    assert.equal(result.id, validationId);
    assert.equal(result.status, "QUEUED");
    assert.equal(capturedMethod, "POST");
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/integrations/credentials/${credentialId}/validations`
    );
    assert.deepEqual(capturedBody, {
      workspaceId,
      actorId,
      idempotencyKey: "credential-validation-001"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gets and validates a credential validation response", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedMethod: string | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedMethod = init?.method;
    return validationResponse("SUCCEEDED", {
      startedAt: "2026-07-29T09:00:01.000Z",
      finishedAt: "2026-07-29T09:00:02.000Z"
    });
  }) as typeof fetch;

  try {
    const result = await client().getIntegrationCredentialValidation(
      context("request-validation-get-001"),
      credentialId,
      validationId
    );

    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.finishedAt, "2026-07-29T09:00:02.000Z");
    assert.equal(capturedMethod, "GET");
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/integrations/credentials/${credentialId}/validations/${validationId}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves the scheduled retry time for a nonterminal validation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    validationResponse("RETRY_SCHEDULED", {
      startedAt: "2026-07-29T09:00:01.000Z",
      retryAt: "2026-07-29T09:00:06.000Z"
    })) as typeof fetch;

  try {
    const result = await client().getIntegrationCredentialValidation(
      context("request-validation-retry-001"),
      credentialId,
      validationId
    );

    assert.equal(result.status, "RETRY_SCHEDULED");
    assert.equal(result.retryAt, "2026-07-29T09:00:06.000Z");
    assert.equal(result.finishedAt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an invalid credential validation response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    validationResponse("UNKNOWN")) as typeof fetch;

  try {
    await assert.rejects(
      client().getIntegrationCredentialValidation(
        context("request-validation-get-002"),
        credentialId,
        validationId
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 502 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a credential validation outside the trusted scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    validationResponse("QUEUED", {
      workspaceId: "01900000-0000-7000-8000-000000000099"
    })) as typeof fetch;

  try {
    await assert.rejects(
      client().getIntegrationCredentialValidation(
        context("request-validation-get-003"),
        credentialId,
        validationId
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 502 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards project binding create through the dedicated trusted boundary", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedHeaders = new Headers(init?.headers);
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return dataResponse(projectBindingResponseData());
  }) as typeof fetch;

  try {
    const result = await client().createProjectConnectorBinding(
      projectContext("request-project-binding-create-001"),
      {
        capability: "SERP_RANK_TRACKING",
        enabled: true,
        route: {
          position: 0,
          sourceKind: "WORKSPACE_CREDENTIAL",
          credentialId
        },
        fallbackPolicy: { mode: "NONE" },
        budgetPolicy: { mode: "DISABLED" }
      },
      "project-binding-create-001"
    );

    assert.equal(result.id, bindingId);
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/integration-settings`
    );
    assert.equal(capturedHeaders?.get("x-workspace-id"), workspaceId);
    assert.equal(capturedHeaders?.get("x-project-id"), projectId);
    assert.equal(
      capturedHeaders?.get("x-internal-token"),
      "c".repeat(32)
    );
    assert.deepEqual(capturedBody, {
      workspaceId,
      projectId,
      actorId,
      idempotencyKey: "project-binding-create-001",
      capability: "SERP_RANK_TRACKING",
      enabled: true,
      route: {
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL",
        credentialId
      },
      fallbackPolicy: { mode: "NONE" },
      budgetPolicy: { mode: "DISABLED" }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validates the complete project connector aggregate and tenant scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    dataResponse({
      bindings: [projectBindingResponseData()],
      credentialOptions: [projectCredentialOptionResponseData()],
      credentialOptionsTruncated: false
    })) as typeof fetch;

  try {
    const result = await client().projectConnectorBindings(
      projectContext("request-project-bindings-get-001")
    );
    assert.equal(result.bindings[0]?.availability, "READY");
    assert.equal(result.credentialOptions[0]?.label, "Primary");
    assert.equal(result.credentialOptionsTruncated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts a disabled project binding after transfer revoked every route", async () => {
  const configured = projectBindingResponseData();
  const { route: _retiredRoute, ...reset } = configured;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    dataResponse({
      bindings: [
        {
          ...reset,
          enabled: false,
          configurationScope: "PROJECT_OVERRIDE",
          routes: [],
          fallbackPolicy: { mode: "NONE", reasons: [] },
          availability: "DISABLED",
          version: 2
        }
      ],
      credentialOptions: [projectCredentialOptionResponseData()],
      credentialOptionsTruncated: false
    })) as typeof fetch;

  try {
    const result = await client().projectConnectorBindings(
      projectContext("request-project-bindings-reset-001")
    );
    assert.equal(result.bindings[0]?.route, undefined);
    assert.deepEqual(result.bindings[0]?.routes, []);
    assert.equal(result.bindings[0]?.availability, "DISABLED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts the safe XMLStock quota in workspace routing credential options", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    dataResponse({
      bindings: [],
      credentialOptions: [
        {
          ...projectCredentialOptionResponseData(),
          provider: "XMLSTOCK",
          label: "XMLStock primary",
          capabilities: ["SERP_RANK_TRACKING", "WORDSTAT"],
          quota: {
            status: "AVAILABLE",
            unit: "XMLSTOCK_REQUESTS",
            remaining: 0,
            balance: {
              amount: "2143.29",
              frozenAmount: "0",
              currency: "RUB"
            },
            usedToday: 0,
            usedMonth: 0,
            frozenRemaining: 0,
            tariffDaysRemaining: 0,
            observedAt: "2026-08-04T17:43:20.226Z"
          }
        }
      ],
      credentialOptionsTruncated: false,
      access: {
        canUpdateBindings: false,
        canManageFallback: false
      }
    })) as typeof fetch;

  try {
    const result = await client().workspaceConnectorRouting(
      context("request-workspace-routing-xmlstock-quota-001")
    );
    assert.equal(result.credentialOptions[0]?.provider, "XMLSTOCK");
    assert.deepEqual(result.credentialOptions[0]?.quota, {
      status: "AVAILABLE",
      unit: "XMLSTOCK_REQUESTS",
      remaining: 0,
      balance: {
        amount: "2143.29",
        frozenAmount: "0",
        currency: "RUB"
      },
      usedToday: 0,
      usedMonth: 0,
      frozenRemaining: 0,
      tariffDaysRemaining: 0,
      observedAt: "2026-08-04T17:43:20.226Z"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts an empty disabled workspace route after the only key is disconnected", async () => {
  const originalFetch = globalThis.fetch;
  const binding = {
    id: bindingId,
    workspaceId,
    capability: "SERP_RANK_TRACKING",
    enabled: false,
    routes: [],
    fallbackPolicy: { mode: "NONE", reasons: [] },
    version: 2,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:01:00.000Z"
  };
  const response = (candidate: typeof binding) => dataResponse({
    bindings: [candidate],
    credentialOptions: [],
    credentialOptionsTruncated: false,
    access: { canUpdateBindings: true, canManageFallback: true }
  });
  try {
    globalThis.fetch = (async () => response(binding)) as typeof fetch;
    const settings = await client().workspaceConnectorRouting(
      context("request-workspace-routing-after-revoke-001")
    );
    assert.deepEqual(settings.bindings[0]?.routes, []);
    assert.equal(settings.bindings[0]?.enabled, false);
    globalThis.fetch = (async () => response({ ...binding, enabled: true })) as typeof fetch;
    await assert.rejects(
      client().workspaceConnectorRouting(context("request-workspace-routing-invalid-empty-001")),
      DomainError
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects scoped, duplicate and secret-bearing project connector responses", async () => {
  const originalFetch = globalThis.fetch;
  const badPayloads: readonly unknown[] = [
    {
      bindings: [
        projectBindingResponseData({
          projectId: "01900000-0000-7000-8000-000000000099"
        })
      ],
      credentialOptions: [projectCredentialOptionResponseData()],
      credentialOptionsTruncated: false
    },
    {
      bindings: [projectBindingResponseData()],
      credentialOptions: [
        {
          ...projectCredentialOptionResponseData(),
          displayHint: "must-not-cross-boundary"
        }
      ],
      credentialOptionsTruncated: false
    },
    {
      bindings: [
        projectBindingResponseData(),
        projectBindingResponseData({
          id: "01900000-0000-7000-8000-000000000010",
          route: projectRouteResponseData({
            id: "01900000-0000-7000-8000-000000000011",
            bindingId: "01900000-0000-7000-8000-000000000010"
          })
        })
      ],
      credentialOptions: [projectCredentialOptionResponseData()],
      credentialOptionsTruncated: false
    },
    {
      bindings: [projectBindingResponseData()],
      credentialOptions: [
        {
          ...projectCredentialOptionResponseData(),
          status: "PENDING_VERIFICATION"
        }
      ],
      credentialOptionsTruncated: false
    },
    {
      bindings: [projectBindingResponseData()],
      credentialOptions: [projectCredentialOptionResponseData()],
      credentialOptionsTruncated: "false"
    }
  ];

  try {
    for (const payload of badPayloads) {
      globalThis.fetch = (async (): Promise<Response> =>
        dataResponse(payload)) as typeof fetch;
      await assert.rejects(
        client().projectConnectorBindings(
          projectContext("request-project-bindings-invalid")
        ),
        (error: unknown) =>
          error instanceof DomainError &&
          error.statusCode === 502 &&
          error.code === "DEPENDENCY_UNAVAILABLE"
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps only safe project binding conflict details from upstream", async () => {
  const originalFetch = globalThis.fetch;
  const conflictCases = [
    {
      status: 412,
      payload: {
        code: "VERSION_CONFLICT",
        currentVersion: 4,
        secret: "ignored"
      },
      expectedCode: "VERSION_CONFLICT",
      expectedVersion: 4
    },
    {
      status: 409,
      payload: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "unsafe upstream message"
      },
      expectedCode: "IDEMPOTENCY_CONFLICT",
      expectedVersion: undefined
    }
  ] as const;

  try {
    for (const candidate of conflictCases) {
      globalThis.fetch = (async (): Promise<Response> =>
        new Response(JSON.stringify(candidate.payload), {
          status: candidate.status,
          headers: { "content-type": "application/json" }
        })) as typeof fetch;
      await assert.rejects(
        client().updateProjectConnectorBinding(
          projectContext("request-project-binding-conflict"),
          bindingId,
          {
            enabled: false,
            route: {
              position: 0,
              sourceKind: "WORKSPACE_CREDENTIAL",
              credentialId
            },
            fallbackPolicy: { mode: "NONE" },
            budgetPolicy: { mode: "DISABLED" }
          },
          1
        ),
        (error: unknown) => {
          assert.ok(error instanceof DomainError);
          assert.equal(error.code, candidate.expectedCode);
          assert.equal(
            error.details?.currentVersion,
            candidate.expectedVersion
          );
          assert.equal(error.message.includes("unsafe"), false);
          return true;
        }
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function client(): JobsClient {
  return new JobsClient(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_JOBS_TOKEN: "i".repeat(32),
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
      JOBS_INTERNAL_URL: "http://jobs.test:4002"
    })
  );
}

function projectContext(requestId: string): {
  readonly tenant: {
    readonly workspaceId: string;
    readonly workspaceStatus: "ACTIVE";
    readonly projectId: string;
    readonly projectStatus: "ACTIVE";
    readonly roleCode: "OWNER";
  };
  readonly actorId: string;
  readonly requestId: string;
} {
  return {
    tenant: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "OWNER"
    },
    actorId,
    requestId
  };
}

function context(requestId: string): {
  readonly tenant: {
    readonly workspaceId: string;
    readonly workspaceStatus: "ACTIVE";
    readonly roleCode: "OWNER";
  };
  readonly actorId: string;
  readonly requestId: string;
} {
  return {
    tenant: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      roleCode: "OWNER"
    },
    actorId,
    requestId
  };
}

function validationResponse(
  status: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Response {
  return new Response(
    JSON.stringify({
      data: validationResponseData(status, overrides)
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}

function validationResponseData(
  status: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    id: validationId,
    workspaceId,
    credentialId,
    credentialMaterialVersion: 1,
    provider: "KEYS_SO",
    status,
    connectorVersion: "1.0.0",
    requestedAt: "2026-07-29T09:00:00.000Z",
    ...overrides
  };
}

function credentialResponseData(): Readonly<Record<string, unknown>> {
  return {
    id: credentialId,
    workspaceId,
    provider: "KEYS_SO",
    label: "Primary",
    mode: "BYOK_API_KEY",
    status: "PENDING_VERIFICATION",
    displayHint: "••••-key",
    capabilities: [
      "KEYWORD_RESEARCH",
      "COMPETITOR_RESEARCH",
      "SERP_COLLECTION"
    ],
    quota: { status: "NOT_AVAILABLE" },
    version: 1,
    createdAt: "2026-07-29T09:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z"
  };
}

function dataResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function crawlResponseData(
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    id: crawlId,
    jobId: crawlJobId,
    workspaceId,
    projectId,
    status: "QUEUED",
    config: {
      purpose: "TECHNICAL_AUDIT",
      startUrls: ["https://example.com/"],
      sitemapUrls: [],
      includePatterns: [],
      excludePatterns: [],
      queryPolicy: "DROP_TRACKING",
      maxUrls: 100,
      maxDepth: 3,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 30,
      obeyRobots: true,
      savePageMap: true
    },
    discoveredUrls: 1,
    processedUrls: 0,
    successfulUrls: 0,
    failedUrls: 0,
    issueCount: 0,
    version: 1,
    createdAt: "2026-07-31T05:00:00.000Z",
    ...overrides
  };
}

function projectBindingResponseData(
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    id: bindingId,
    workspaceId,
    projectId,
    capability: "SERP_RANK_TRACKING",
    enabled: true,
    route: projectRouteResponseData(),
    fallbackPolicy: { mode: "NONE" },
    budgetPolicy: { mode: "DISABLED" },
    availability: "READY",
    version: 1,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: "2026-07-29T09:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z",
    ...overrides
  };
}

function projectRouteResponseData(
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    id: routeId,
    bindingId,
    workspaceId,
    projectId,
    position: 0,
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId,
    provider: "ARSENKIN",
    credentialMode: "BYOK_API_KEY",
    createdAt: "2026-07-29T09:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z",
    ...overrides
  };
}

function projectCredentialOptionResponseData(): Readonly<
  Record<string, unknown>
> {
  return {
    id: credentialId,
    workspaceId,
    provider: "ARSENKIN",
    label: "Primary",
    mode: "BYOK_API_KEY",
    status: "ACTIVE",
    capabilities: ["SERP_RANK_TRACKING"]
  };
}
