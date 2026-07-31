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
      startUrls: ["https://example.com/"],
      sitemapUrls: [],
      includePatterns: [],
      excludePatterns: [],
      queryPolicy: "DROP_TRACKING",
      maxUrls: 100,
      maxDepth: 3,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 30,
      obeyRobots: true
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts only a bounded queued host backoff projection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    dataResponse(crawlResponseData({
      backoffCode: "HOST_RATE_LIMIT",
      backoffUntil: "2026-07-31T05:05:00.000Z"
    }))) as typeof fetch;
  try {
    const crawl = await client().getTechnicalCrawl(
      projectContext("request-crawl-backoff-001"),
      crawlId
    );
    assert.equal(crawl.backoffCode, "HOST_RATE_LIMIT");
    assert.equal(
      crawl.backoffUntil,
      "2026-07-31T05:05:00.000Z"
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
      startUrls: ["https://example.com/"],
      sitemapUrls: [],
      includePatterns: [],
      excludePatterns: [],
      queryPolicy: "DROP_TRACKING",
      maxUrls: 100,
      maxDepth: 3,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 30,
      obeyRobots: true
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
