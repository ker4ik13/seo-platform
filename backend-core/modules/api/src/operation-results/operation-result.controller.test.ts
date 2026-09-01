import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import type { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { DomainError } from "../common/domain-error.js";
import { CrawlController } from "../crawls/crawl.controller.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import type { JobsClient } from "../jobs/jobs.client.js";
import { RankRunController } from "../rankings/rank-run.controller.js";
import { FrequencyCollectionController } from "../semantics/frequency-collection.controller.js";
import { AiAnswerCollectionController } from "../semantics/ai-answer-collection.controller.js";
import type { SeoDataClient } from "../seo-data/seo-data.client.js";
import type { TenantService } from "../tenants/tenant.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const crawlId = "01900000-0000-7000-8000-000000000005";
const firstKeywordId = "01900000-0000-7000-8000-000000000006";
const secondKeywordId = "01900000-0000-7000-8000-000000000007";
const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000008",
  sessionFamilyId: "01900000-0000-7000-8000-000000000009",
  authenticatedAt: new Date("2026-08-02T09:00:00.000Z"),
  expiresAt: new Date("2026-08-02T12:00:00.000Z")
};

test("publishes guarded project result routes with read permissions", () => {
  assertRoute(
    FrequencyCollectionController.prototype.result,
    ":jobId/result",
    "collector.view"
  );
  assertRoute(
    AiAnswerCollectionController.prototype.result,
    ":jobId/result",
    "collector.view"
  );
  assertRoute(
    RankRunController.prototype.result,
    "jobs/:jobId/result",
    "ranking.view"
  );
  assertRoute(
    CrawlController.prototype.result,
    "crawls/:crawlId/result",
    "page.view"
  );
});

test("joins frequency rows only against the exact Jobs-owned item scope", async () => {
  const contexts: unknown[] = [];
  let requestedKeywordIds: readonly string[] = [];
  const jobs = {
    getFrequencyCollection: async (context: unknown) => {
      contexts.push(context);
      return { id: jobId, workspaceId, projectId };
    },
    getFrequencyOperationScope: async (
      context: unknown,
      requestedJobId: string,
      limit: number,
      cursor?: string
    ) => {
      contexts.push(context);
      assert.equal(requestedJobId, jobId);
      assert.equal(limit, 200);
      assert.equal(cursor, undefined);
      return {
        workspaceId,
        projectId,
        jobId,
        items: [
          {
            sequence: 0,
            keywordId: firstKeywordId,
            status: "COMPLETED"
          },
          {
            sequence: 1,
            keywordId: secondKeywordId,
            status: "FAILED_FINAL",
            errorCode: "PROVIDER_REJECTED"
          }
        ],
        page: { hasNext: false }
      };
    }
  };
  const seoData = {
    frequencyOperationResult: async (
      context: unknown,
      requestedJobId: string,
      keywordIds: readonly string[]
    ) => {
      contexts.push(context);
      assert.equal(requestedJobId, jobId);
      requestedKeywordIds = keywordIds;
      return {
        workspaceId,
        projectId,
        jobId,
        rows: [
          { keywordId: secondKeywordId, keyword: "second", snapshots: [] },
          { keywordId: firstKeywordId, keyword: "first", snapshots: [] }
        ]
      };
    }
  };
  const controller = new FrequencyCollectionController(
    jobs as unknown as JobsClient,
    {} as BillingEntitlementService,
    {} as AuditService,
    seoData as unknown as SeoDataClient
  );

  const response = await controller.result(
    jobId,
    undefined,
    undefined,
    request(),
    principal
  );

  assert.deepEqual(requestedKeywordIds, [firstKeywordId, secondKeywordId]);
  assert.deepEqual(
    response.data.rows.map(({ sequence, keyword, status }) => ({
      sequence,
      keyword,
      status
    })),
    [
      { sequence: 0, keyword: "first", status: "COMPLETED" },
      { sequence: 1, keyword: "second", status: "FAILED_FINAL" }
    ]
  );
  for (const context of contexts) assert.deepEqual(context, internalContext());
});

test("returns rank and crawl results without internal tenant envelope fields", async () => {
  const rankController = new RankRunController(
    {
      getRankJob: async (context: unknown) => {
        assert.deepEqual(context, internalContext());
        return { id: jobId, workspaceId, projectId };
      }
    } as unknown as JobsClient,
    {} as TenantService,
    {} as AuditService,
    {} as BillingEntitlementService,
    {
      rankOperationResult: async (
        context: unknown,
        requestedJobId: string,
        limit: number,
        cursor?: string
      ) => {
        assert.deepEqual(context, internalContext());
        assert.equal(requestedJobId, jobId);
        assert.equal(limit, 200);
        assert.equal(cursor, undefined);
        return {
          workspaceId,
          projectId,
          jobId,
          trackingContextId: firstKeywordId,
          contextName: "Google · Москва",
          execution: {},
          rows: [],
          page: { hasNext: false }
        };
      }
    } as unknown as SeoDataClient
  );
  const rank = await rankController.result(
    jobId,
    undefined,
    undefined,
    request(),
    principal
  );
  assert.equal("workspaceId" in rank.data, false);
  assert.equal("projectId" in rank.data, false);
  assert.equal(rank.data.jobId, jobId);

  const crawlController = new CrawlController(
    {
      getTechnicalCrawl: async (context: unknown) => {
        assert.deepEqual(context, internalContext());
        return { id: crawlId, workspaceId, projectId };
      }
    } as unknown as JobsClient,
    {
      crawlOperationResult: async (
        context: unknown,
        requestedCrawlId: string,
        limit: number,
        cursor?: string
      ) => {
        assert.deepEqual(context, internalContext());
        assert.equal(requestedCrawlId, crawlId);
        assert.equal(limit, 25);
        assert.equal(cursor, "10");
        return {
          workspaceId,
          projectId,
          crawlId,
          rows: [],
          page: { hasNext: false }
        };
      }
    } as unknown as SeoDataClient,
    {} as AuditService,
    {} as BillingEntitlementService,
    {} as never
  );
  const crawl = await crawlController.result(
    crawlId,
    "25",
    "10",
    request(),
    principal
  );
  assert.equal("workspaceId" in crawl.data, false);
  assert.equal("projectId" in crawl.data, false);
  assert.equal(crawl.data.crawlId, crawlId);

  await assert.rejects(
    () =>
      crawlController.result(
        crawlId,
        "1001",
        undefined,
        request(),
        principal
      ),
    (error: unknown) =>
      error instanceof DomainError && error.code === "VALIDATION_FAILED"
  );
});

test("joins XMLStock rank rows with per-key attempts and final errors", async () => {
  const rankController = new RankRunController(
    {
      getRankJob: async () => ({
        id: jobId,
        workspaceId,
        projectId,
        provider: "XMLSTOCK"
      }),
      getRankOperationScope: async (
        _context: unknown,
        requestedJobId: string,
        limit: number,
        cursor?: string
      ) => {
        assert.equal(requestedJobId, jobId);
        assert.equal(limit, 200);
        assert.equal(cursor, undefined);
        return {
          workspaceId,
          projectId,
          jobId,
          items: [
            { sequence: 0, status: "COMPLETED", pollAttempts: 5 },
            {
              sequence: 1,
              status: "FAILED_FINAL",
              pollAttempts: 50,
              errorCode: "PROVIDER_UNAVAILABLE"
            }
          ],
          page: { hasNext: false }
        };
      }
    } as unknown as JobsClient,
    {} as TenantService,
    {} as AuditService,
    {} as BillingEntitlementService,
    {
      rankOperationResult: async () => ({
        workspaceId,
        projectId,
        jobId,
        trackingContextId: firstKeywordId,
        contextName: "Яндекс · Москва",
        execution: {},
        rows: [
          {
            sequence: 0,
            keywordId: firstKeywordId,
            keyword: "готовый запрос",
            state: "NOT_FOUND",
            dataQualityFlags: []
          },
          {
            sequence: 1,
            keywordId: secondKeywordId,
            keyword: "неснятый запрос",
            state: "PENDING",
            dataQualityFlags: []
          }
        ],
        page: { hasNext: false }
      })
    } as unknown as SeoDataClient
  );

  const response = await rankController.result(
    jobId,
    undefined,
    undefined,
    request(),
    principal
  );

  assert.deepEqual(
    response.data.rows.map(({ sequence, status, pollAttempts, errorCode }) => ({
      sequence,
      status,
      pollAttempts,
      errorCode
    })),
    [
      {
        sequence: 0,
        status: "COMPLETED",
        pollAttempts: 5,
        errorCode: undefined
      },
      {
        sequence: 1,
        status: "FAILED_FINAL",
        pollAttempts: 50,
        errorCode: "PROVIDER_UNAVAILABLE"
      }
    ]
  );
});

function assertRoute(
  method: (...args: never[]) => unknown,
  path: string,
  permission: string
): void {
  assert.equal(Reflect.getMetadata(PATH_METADATA, method), path);
  assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, method), permission);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
    SessionAuthGuard,
    TenantPermissionGuard
  ]);
}

function request(): TenantRequest {
  return {
    id: "request-operation-result-001",
    headers: {},
    tenantAuthorization: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "SEO_SPECIALIST",
      membershipId: "01900000-0000-7000-8000-000000000010",
      membershipVersion: 2,
      projectAccessLevel: "MEMBER"
    }
  } as TenantRequest;
}

function internalContext() {
  return {
    tenant: request().tenantAuthorization,
    actorId,
    requestId: "request-operation-result-001"
  };
}
