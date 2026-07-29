import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { KeywordService } from "./keyword.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";

test("returns a scoped cursor page with groups, tags and target URLs", async () => {
  let observedWhere: unknown;
  const rows = [
    keyword("01900000-0000-7000-8000-000000000010", "2026-07-29T08:00:00Z"),
    keyword("01900000-0000-7000-8000-000000000011", "2026-07-29T07:00:00Z")
  ];
  const service = new KeywordService({
    keyword: {
      findMany: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return rows;
      },
      count: async () => 2
    },
    page: {
      findMany: async () => [
        {
          id: "01900000-0000-7000-8000-000000000020",
          url: "https://example.com/seo"
        }
      ]
    },
    trackingContextKeywordAssignment: {
      findMany: async () => [
        {
          keywordId: "01900000-0000-7000-8000-000000000010"
        }
      ]
    }
  } as unknown as PrismaService);

  const result = await service.list(
    workspaceId,
    projectId,
    { limit: 1, search: "SEO" },
    "request-1"
  );

  assert.equal(result.data.length, 1);
  assert.equal(result.data[0]?.groupPath, "Услуги / SEO");
  assert.equal(result.data[0]?.targetUrl, "https://example.com/seo");
  assert.deepEqual(result.data[0]?.tags, ["Приоритет"]);
  assert.equal(result.data[0]?.isTracked, true);
  assert.equal(result.page.hasNext, true);
  assert.equal(result.page.totalApprox, 2);
  assert.ok(result.page.nextCursor);
  assert.ok(observedWhere);

  await assert.rejects(
    () =>
      service.list(
        workspaceId,
        projectId,
        {
          limit: 1,
          cursor: result.page.nextCursor!,
          search: "another query"
        },
        "request-2"
      ),
    BadRequestException
  );
});

function keyword(id: string, createdAt: string) {
  return {
    id,
    workspaceId,
    projectId,
    textOriginal: "SEO аудит",
    textNormalized: "seo аудит",
    normalizedHash: "a".repeat(64),
    language: "ru",
    priority: 0,
    status: "ACTIVE" as const,
    clusterId: null,
    targetPageId: "01900000-0000-7000-8000-000000000020",
    isTracked: false,
    customValues: {},
    sourceMode: "IMPORT" as const,
    sourceId: null,
    createdBy: null,
    updatedBy: null,
    version: 1,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    deletedAt: null,
    memberships: [
      {
        group: {
          path: "Услуги / SEO",
          name: "SEO"
        }
      }
    ],
    tags: [{ tag: { name: "Приоритет" } }]
  };
}
