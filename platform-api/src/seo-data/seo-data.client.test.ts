import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import {
  scopedTrackingContextKeywordState,
  trackingContextCollection,
  trackingContextKeywordPage
} from "../rankings/tracking-context-response.js";
import {
  semanticKeywordGroups,
  semanticKeywordBulkResult,
  semanticKeywordPage,
  semanticClusters,
  semanticCustomColumns,
  semanticKeywordCustomValue,
  semanticSavedViews,
  SeoDataClient
} from "./seo-data.client.js";

const validItem = {
  id: "01900000-0000-7000-8000-000000000010",
  textOriginal: "SEO аудит",
  textNormalized: "seo аудит",
  language: "ru",
  priority: 0,
  isFavorite: true,
  isTracked: false,
  intent: "COMMERCIAL",
  groupId: "01900000-0000-7000-8000-000000000011",
  groupPath: "Услуги / SEO",
  targetPageId: "01900000-0000-7000-8000-000000000012",
  targetUrl: "https://example.com/seo",
  tags: ["Приоритет"],
  tagsTruncated: false,
  sourceMode: "IMPORT",
  createdAt: "2026-07-29T08:00:00.000Z",
  updatedAt: "2026-07-29T08:00:00.000Z",
  version: 1
};
const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const contextId = "01900000-0000-7000-8000-000000000004";
const keywordId = "01900000-0000-7000-8000-000000000005";
const assignmentId = "01900000-0000-7000-8000-000000000006";
const contextResponse = {
  id: contextId,
  workspaceId,
  projectId,
  name: "Google · Москва · desktop",
  status: "ACTIVE",
  configuration: {
    searchEngine: "GOOGLE",
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP",
    depth: 30,
    domainMatchRule: { mode: "INCLUDE_WWW" },
    safeSearch: false,
    configurationVersion: 1,
    createdBy: actorId,
    createdAt: "2026-07-29T10:00:00.000Z"
  },
  assignedKeywordCount: 1,
  version: 1,
  createdBy: actorId,
  updatedBy: actorId,
  createdAt: "2026-07-29T10:00:00.000Z",
  updatedAt: "2026-07-29T10:00:00.000Z"
};

test("accepts a strictly shaped semantic keyword page", () => {
  const result = semanticKeywordPage({
    data: [validItem],
    page: { hasNext: false, totalApprox: 1 },
    meta: { requestId: "internal-request" }
  });

  assert.equal(result.data[0]?.textOriginal, "SEO аудит");
  assert.deepEqual(result.page, { hasNext: false, totalApprox: 1 });
});

test("rejects malformed SEO data responses", () => {
  assert.throws(
    () =>
      semanticKeywordPage({
        data: [{ ...validItem, sourceMode: "UNKNOWN" }],
        page: { hasNext: false }
      }),
    DomainError
  );
  assert.throws(
    () =>
      semanticKeywordPage({
        data: [validItem],
        page: { hasNext: "false" }
      }),
    DomainError
  );
});

test("validates a complete semantic group tree", () => {
  const parentId = "01900000-0000-7000-8000-000000000020";
  const childId = "01900000-0000-7000-8000-000000000021";
  const groups = semanticKeywordGroups([
    {
      id: parentId,
      name: "Услуги",
      path: "Услуги",
      color: "#6758ef",
      position: 0,
      keywordCount: 1,
      version: 1,
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z"
    },
    {
      id: childId,
      parentId,
      name: "SEO",
      path: "Услуги / SEO",
      position: 0,
      keywordCount: 2,
      version: 1,
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z"
    }
  ]);
  assert.equal(groups[1]?.parentId, parentId);
  assert.throws(
    () =>
      semanticKeywordGroups([
        { ...groups[1], parentId: "01900000-0000-7000-8000-000000000099" }
      ]),
    DomainError
  );
});

test("validates unique manual semantic clusters", () => {
  const cluster = {
    id: "01900000-0000-7000-8000-000000000022",
    name: "SEO аудит",
    method: "MANUAL",
    keywordCount: 4,
    pageDiagnostics: {
      mappedKeywordCount: 3,
      unmappedKeywordCount: 1,
      competingPageCount: 1,
      hasCannibalization: true,
      hasMissingLanding: true
    },
    version: 2,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T11:00:00.000Z"
  };
  assert.equal(semanticClusters([cluster])[0]?.keywordCount, 4);
  assert.throws(() => semanticClusters([{ ...cluster, method: "UNKNOWN" }]), DomainError);
  assert.throws(() => semanticClusters([cluster, cluster]), DomainError);
});

test("validates a complete semantic bulk result partition", () => {
  const first = validItem.id;
  const second = "01900000-0000-7000-8000-000000000030";
  const input = {
    items: [
      { id: first, version: 1 },
      { id: second, version: 2 }
    ],
    patch: { priority: 10 }
  };
  const result = semanticKeywordBulkResult(
    {
      selected: 2,
      changed: 1,
      skipped: 0,
      failed: 0,
      conflicted: 1,
      updatedItems: [validItem],
      conflictedIds: [second],
      skippedIds: [],
      failedIds: []
    },
    input
  );
  assert.equal(result.changed, 1);
  assert.throws(
    () =>
      semanticKeywordBulkResult(
        {
          ...result,
          changed: 2,
          updatedItems: [validItem]
        },
        input
      ),
    DomainError
  );
});

test("validates versioned semantic saved views and rejects DSL drift", () => {
  const view = {
    id: "01900000-0000-7000-8000-000000000040",
    ownerId: actorId,
    scope: "PRIVATE",
    name: "Основное",
    config: {
      schemaVersion: 1,
      filters: { isTracked: true, priorityMin: 10 },
      sort: "PRIORITY_DESC",
      columns: ["query", "priority"],
      density: "COMPACT"
    },
    version: 2,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T11:00:00.000Z"
  };
  assert.equal(semanticSavedViews([view])[0]?.config.sort, "PRIORITY_DESC");
  assert.throws(
    () =>
      semanticSavedViews([
        {
          ...view,
          config: { ...view.config, columns: ["query", "query"] }
        }
      ]),
    DomainError
  );
  assert.throws(
    () => semanticSavedViews([view, view]),
    DomainError
  );
});

test("validates typed custom column definitions and values", () => {
  const column = {
    id: "01900000-0000-7000-8000-000000000050",
    name: "Этап",
    type: "STATUS",
    config: {
      required: true,
      options: [
        { id: "new", label: "Новый" },
        { id: "done", label: "Готово", color: "#22aa66" }
      ]
    },
    version: 1,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T10:00:00.000Z"
  };
  assert.equal(semanticCustomColumns([column])[0]?.type, "STATUS");
  assert.deepEqual(
    semanticKeywordCustomValue({
      columnId: column.id,
      value: "new",
      version: 2,
      updatedAt: "2026-07-30T11:00:00.000Z"
    }).value,
    "new"
  );
  assert.throws(
    () =>
      semanticCustomColumns([
        { ...column, config: { required: true } }
      ]),
    DomainError
  );
});

test("accepts a scoped bounded tracking-context aggregate", () => {
  const result = trackingContextCollection(
    {
      contexts: [contextResponse],
      contextsTruncated: false
    },
    workspaceId,
    projectId
  );

  assert.equal(result.contexts[0]?.id, contextId);
  assert.equal(
    result.contexts[0]?.configuration.configurationVersion,
    1
  );
  assert.equal(result.contextsTruncated, false);
});

test("rejects malformed, duplicate and cross-tenant tracking contexts", () => {
  assert.throws(
    () =>
      trackingContextCollection(
        {
          contexts: [
            contextResponse,
            { ...contextResponse, name: "Duplicate" }
          ],
          contextsTruncated: false
        },
        workspaceId,
        projectId
      ),
    DomainError
  );
  assert.throws(
    () =>
      trackingContextCollection(
        {
          contexts: [
            {
              ...contextResponse,
              providerCredentialId:
                "01900000-0000-7000-8000-000000000098"
            }
          ],
          contextsTruncated: false
        },
        workspaceId,
        projectId
      ),
    DomainError
  );
  assert.throws(
    () =>
      trackingContextCollection(
        {
          contexts: [
            {
              ...contextResponse,
              workspaceId:
                "01900000-0000-7000-8000-000000000099"
            }
          ],
          contextsTruncated: false
        },
        workspaceId,
        projectId
      ),
    DomainError
  );
  assert.throws(
    () =>
      trackingContextCollection(
        {
          contexts: [
            {
              ...contextResponse,
              status: "ARCHIVED"
            }
          ],
          contextsTruncated: false
        },
        workspaceId,
        projectId
      ),
    DomainError
  );
});

test("validates assigned keyword pages and point mutation states", () => {
  const page = trackingContextKeywordPage(
    {
      data: [
        {
          assignmentId,
          contextId,
          keywordId,
          textOriginal: "SEO аудит",
          language: "ru",
          assignedBy: actorId,
          assignedAt: "2026-07-29T10:05:00.000Z"
        }
      ],
      page: {
        hasNext: false,
        totalApprox: 1
      },
      meta: { requestId: "internal-request-001" }
    },
    contextId
  );
  const assigned = scopedTrackingContextKeywordState(
    {
      contextId,
      keywordId,
      assigned: true,
      assignmentId,
      changedAt: "2026-07-29T10:05:00.000Z"
    },
    contextId,
    keywordId,
    true
  );

  assert.equal(page.data[0]?.keywordId, keywordId);
  assert.equal(assigned.assignmentId, assignmentId);
  assert.throws(
    () =>
      scopedTrackingContextKeywordState(
        {
          contextId,
          keywordId,
          assigned: false,
          assignmentId
        },
        contextId,
        keywordId,
        false
      ),
    DomainError
  );
});

test("forwards an idempotent create through trusted tenant headers and body", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  let capturedRedirect: RequestInit["redirect"];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedHeaders = new Headers(init?.headers);
    capturedRedirect = init?.redirect;
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return jsonResponse({ data: contextResponse });
  }) as typeof fetch;

  try {
    const result = await client().createTrackingContext(
      internalContext(),
      {
        name: contextResponse.name,
        configuration: {
          searchEngine: "GOOGLE",
          countryCode: "RU",
          regionCode: "213",
          regionLabel: "Москва",
          language: "ru",
          device: "DESKTOP",
          depth: 30,
          domainMatchRule: { mode: "INCLUDE_WWW" },
          safeSearch: false
        }
      },
      "tracking-context-create-001"
    );

    assert.equal(result.id, contextId);
    assert.equal(capturedUrl?.pathname, `/internal/v1/projects/${projectId}/tracking-contexts`);
    assert.equal(capturedHeaders?.get("x-workspace-id"), workspaceId);
    assert.equal(capturedHeaders?.get("x-project-id"), projectId);
    assert.deepEqual(capturedBody, {
      name: contextResponse.name,
      configuration: {
        searchEngine: "GOOGLE",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP",
        depth: 30,
        domainMatchRule: { mode: "INCLUDE_WWW" },
        safeSearch: false
      },
      workspaceId,
      projectId,
      actorId,
      idempotencyKey: "tracking-context-create-001"
    });
    assert.equal(capturedRedirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves only the safe current version from an upstream conflict", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        error: {
          code: "VERSION_CONFLICT",
          details: {
            currentVersion: 4,
            internalRevision: "must-not-leak"
          }
        }
      }),
      {
        status: 412,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().updateTrackingContext(
        internalContext(),
        contextId,
        {
          name: contextResponse.name,
          configuration: {
            searchEngine: "GOOGLE",
            countryCode: "RU",
            regionCode: "213",
            regionLabel: "Москва",
            language: "ru",
            device: "DESKTOP",
            depth: 30,
            domainMatchRule: { mode: "INCLUDE_WWW" },
            safeSearch: false
          }
        },
        1
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "VERSION_CONFLICT" &&
        error.statusCode === 412 &&
        error.details?.currentVersion === 4 &&
        !Object.hasOwn(error.details, "internalRevision")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards the semantic undo idempotency key inside the trusted command", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return jsonResponse({
      data: {
        sourceVersionId: contextId,
        applied: 0,
        conflicted: 0,
        unsupported: 0,
        changes: []
      }
    });
  }) as typeof fetch;

  try {
    const result = await client().undoSemanticVersion(
      internalContext(),
      contextId,
      "semantic-undo-client-0001",
      {
        planCode: "TEAM",
        planVersion: 1,
        storedKeywords: 2_000_000,
        keywordsPerProject: 2_000_000,
        trackedContextPairs: 50_000
      }
    );

    assert.equal(result.sourceVersionId, contextId);
    assert.deepEqual(capturedBody, {
      workspaceId,
      projectId,
      actorId,
      idempotencyKey: "semantic-undo-client-0001",
      entitlement: {
        planCode: "TEAM",
        planVersion: 1,
        storedKeywords: 2_000_000,
        keywordsPerProject: 2_000_000,
        trackedContextPairs: 50_000
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function client(): SeoDataClient {
  return new SeoDataClient(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_SEO_DATA_TOKEN: "i".repeat(32),
      SEO_DATA_INTERNAL_URL: "http://seo-data.test:4001"
    })
  );
}

function internalContext() {
  return {
    tenant: {
      workspaceId,
      workspaceStatus: "ACTIVE" as const,
      projectId,
      projectStatus: "ACTIVE" as const,
      roleCode: "OWNER"
    },
    actorId,
    requestId: "request-tracking-context-001"
  };
}

function jsonResponse(value: unknown): Response {
  const response = value as Readonly<Record<string, unknown>>;
  return new Response(
    JSON.stringify({
      ...response,
      meta: { requestId: "internal-request-001" }
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}
