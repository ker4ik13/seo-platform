import assert from "node:assert/strict";
import test from "node:test";
import {
  BadRequestException,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import type {
  InternalUpdateSemanticKeywordInput,
  SemanticKeywordListItem
} from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import type { SemanticVersionService } from "../semantic-versions/semantic-version.service.js";
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
  } as unknown as PrismaService, semanticVersions());

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

test("bulk update partitions changed, conflicted and skipped rows", async () => {
  const changedId = "01900000-0000-7000-8000-000000000040";
  const conflictId = "01900000-0000-7000-8000-000000000041";
  const skippedId = "01900000-0000-7000-8000-000000000042";
  const service = new KeywordService(
    {} as PrismaService,
    semanticVersions()
  );
  service.update = async (
    id: string,
    input: InternalUpdateSemanticKeywordInput
  ) => {
    assert.equal(input.priority, 15);
    if (id === conflictId) {
      throw new HttpException({}, HttpStatus.PRECONDITION_FAILED);
    }
    if (id === skippedId) {
      throw new HttpException({}, HttpStatus.NOT_FOUND);
    }
    return semanticItem(id);
  };

  const result = await service.bulkUpdate({
    workspaceId,
    projectId,
    actorId: "01900000-0000-7000-8000-000000000003",
    items: [
      { id: changedId, version: 1 },
      { id: conflictId, version: 2 },
      { id: skippedId, version: 3 }
    ],
    patch: { priority: 15 }
  });

  assert.equal(result.selected, 3);
  assert.equal(result.changed, 1);
  assert.equal(result.conflicted, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.conflictedIds, [conflictId]);
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
    isFavorite: false,
    intent: null,
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
          id: "01900000-0000-7000-8000-000000000030",
          path: "Услуги / SEO",
          name: "SEO"
        }
      }
    ],
    tags: [{ tag: { name: "Приоритет" } }]
  };
}

function semanticVersions(): SemanticVersionService {
  return {
    createOpenBulkVersion: async (input: {
      workspaceId: string;
      projectId: string;
    }) => ({
      id: "01900000-0000-7000-8000-000000000099",
      workspaceId: input.workspaceId,
      projectId: input.projectId
    }),
    finalizeBulkVersion: async () => ({})
  } as unknown as SemanticVersionService;
}

function semanticItem(id: string): SemanticKeywordListItem {
  return {
    id,
    textOriginal: "SEO аудит",
    textNormalized: "seo аудит",
    language: "ru",
    priority: 15,
    isFavorite: false,
    isTracked: false,
    tags: [],
    tagsTruncated: false,
    sourceMode: "MANUAL",
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T10:00:00.000Z",
    version: 2
  };
}
