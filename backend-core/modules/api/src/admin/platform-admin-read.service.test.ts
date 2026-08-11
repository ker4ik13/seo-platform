import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { JobsClient } from "../jobs/jobs.client.js";
import type { SeoDataClient } from "../seo-data/seo-data.client.js";
import { PlatformAdminReadService } from "./platform-admin-read.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const ownerId = "01900000-0000-7000-8000-000000000003";
const authorId = "01900000-0000-7000-8000-000000000004";
const operationId = "01900000-0000-7000-8000-000000000005";
const now = new Date("2026-08-11T18:30:00.000Z");

test("combines project identities with SEO-owned semantic counts", async () => {
  const service = new PlatformAdminReadService(
    projectPrisma(),
    {
      adminProjectCounts: async () => [
        { projectId, keywordCount: 1640, folderCount: 84 }
      ]
    } as unknown as SeoDataClient,
    {} as JobsClient
  );

  const result = await service.projects(
    { search: "", status: "ACTIVE" },
    ownerId,
    "req-admin"
  );

  assert.equal(result.semanticCountsAvailable, true);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.data[0], {
    id: projectId,
    workspaceId,
    name: "Нейролюб",
    slug: "neuroluv",
    domain: "neuroluv.ru",
    status: "ACTIVE",
    workspace: {
      id: workspaceId,
      name: "Kireev Studio",
      slug: "kireev-studio",
      status: "ACTIVE"
    },
    owner: {
      userId: ownerId,
      email: "owner@example.com",
      displayName: "Владелец",
      status: "ACTIVE"
    },
    author: {
      userId: authorId,
      email: "author@example.com",
      displayName: "Автор",
      status: "ACTIVE"
    },
    keywordCount: 1640,
    folderCount: 84,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  });
});

test("keeps the project directory available when SEO counters are degraded", async () => {
  const service = new PlatformAdminReadService(
    projectPrisma(),
    {
      adminProjectCounts: async () => {
        throw new DomainError({
          statusCode: 503,
          code: "DEPENDENCY_UNAVAILABLE",
          message: "SEO data service unavailable"
        });
      }
    } as unknown as SeoDataClient,
    {} as JobsClient
  );

  const result = await service.projects(
    { search: "" },
    ownerId,
    "req-admin"
  );

  assert.equal(result.semanticCountsAvailable, false);
  assert.equal(result.data[0]?.keywordCount, null);
  assert.equal(result.data[0]?.folderCount, null);
});

test("enriches execution-owned operations without changing the safe summary", async () => {
  const prisma = {
    workspace: {
      findMany: async () => [{ id: workspaceId, name: "Kireev Studio" }]
    },
    project: {
      findMany: async () => [{ id: projectId, name: "Нейролюб", domain: "neuroluv.ru" }]
    },
    user: {
      findMany: async () => [{ id: authorId, displayName: "Автор", emailDisplay: "author@example.com" }]
    }
  } as unknown as PrismaService;
  const jobs = {
    listAdminOperations: async () => ({
      data: [{
        id: operationId,
        workspaceId,
        projectId,
        actorId: authorId,
        type: "MANUAL_RANK_CHECK",
        status: "RUNNING",
        provider: "XMLSTOCK",
        progress: { current: "20", total: "100", unit: "KEYWORDS" },
        result: { found: 17, notFound: 3 },
        attempt: 1,
        maxAttempts: 8,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      }],
      totals: { total: 1, active: 1, completed: 0, attention: 0 },
      types: [{ type: "MANUAL_RANK_CHECK", count: 1 }]
    })
  } as unknown as JobsClient;
  const service = new PlatformAdminReadService(
    prisma,
    {} as SeoDataClient,
    jobs
  );

  const result = await service.operations(
    { statusGroup: "ALL", limit: 50 },
    ownerId,
    "req-admin"
  );

  assert.deepEqual(result.data[0]?.workspace, {
    id: workspaceId,
    name: "Kireev Studio"
  });
  assert.deepEqual(result.data[0]?.project, {
    id: projectId,
    name: "Нейролюб",
    domain: "neuroluv.ru"
  });
  assert.deepEqual(result.data[0]?.actor, {
    id: authorId,
    displayName: "Автор",
    email: "author@example.com"
  });
});

function projectPrisma(): PrismaService {
  return {
    project: {
      findMany: async () => [{
        id: projectId,
        workspaceId,
        name: "Нейролюб",
        slug: "neuroluv",
        domain: "neuroluv.ru",
        status: "ACTIVE",
        createdBy: authorId,
        ownerUserId: ownerId,
        createdAt: now,
        updatedAt: now,
        workspace: {
          id: workspaceId,
          name: "Kireev Studio",
          slug: "kireev-studio",
          status: "ACTIVE"
        }
      }]
    },
    user: {
      findMany: async () => [
        {
          id: ownerId,
          emailDisplay: "owner@example.com",
          displayName: "Владелец",
          status: "ACTIVE"
        },
        {
          id: authorId,
          emailDisplay: "author@example.com",
          displayName: "Автор",
          status: "ACTIVE"
        }
      ]
    }
  } as unknown as PrismaService;
}
