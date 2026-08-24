import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { FastifyRequest } from "fastify";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import type { KeywordGroupService } from "../keyword-groups/keyword-group.service.js";
import type { KeywordService } from "../keywords/keyword.service.js";
import type { SemanticCustomColumnService } from "../semantic-custom-columns/semantic-custom-column.service.js";
import type { SemanticCompetitorExportService } from "./semantic-competitor-export.service.js";
import { SemanticExportReadController } from "./semantic-export-read.controller.js";
import type { SemanticPositionHistoryExportService } from "./semantic-position-history-export.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const headers = {
  "x-workspace-id": workspaceId,
  "x-project-id": projectId,
  "x-actor-id": actorId
} as const;
const request = { id: "semantic-export-read-1" } as FastifyRequest;

test("protects semantic export reads with the Jobs API boundary", () => {
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, SemanticExportReadController),
    [JobsApiGuard]
  );
});

test("forwards bounded export reads inside the trusted tenant context", async () => {
  const calls: unknown[] = [];
  const keywords = {
    list: async (...input: readonly unknown[]) => {
      calls.push(["keywords", ...input]);
      return {
        data: [],
        page: { hasNext: false, totalApprox: 0 },
        meta: { requestId: request.id }
      };
    }
  } as unknown as KeywordService;
  const groups = {
    list: async (...input: readonly unknown[]) => {
      calls.push(["groups", ...input]);
      return [];
    }
  } as unknown as KeywordGroupService;
  const columns = {
    list: async (...input: readonly unknown[]) => {
      calls.push(["columns", ...input]);
      return [];
    }
  } as unknown as SemanticCustomColumnService;
  const positionHistory = {
    list: async (...input: readonly unknown[]) => {
      calls.push(["position-history", ...input]);
      return {
        data: [],
        page: { hasNext: false, totalApprox: 0 },
        meta: { requestId: request.id }
      };
    }
  } as unknown as SemanticPositionHistoryExportService;
  const competitors = {
    list: async (...input: readonly unknown[]) => {
      calls.push(["competitors", ...input]);
      return {
        data: [],
        page: { hasNext: false, totalApprox: 0 },
        meta: { requestId: request.id }
      };
    }
  } as unknown as SemanticCompetitorExportService;
  const controller = new SemanticExportReadController(
    keywords,
    groups,
    columns,
    positionHistory,
    competitors
  );

  assert.deepEqual(
    await controller.listKeywords(
      projectId,
      { limit: "500", search: "seo", sort: "CREATED_ASC" },
      headers,
      request
    ),
    {
      data: [],
      page: { hasNext: false, totalApprox: 0 },
      meta: { requestId: request.id }
    }
  );
  assert.deepEqual(
    await controller.listKeywordGroups(projectId, headers, request),
    { data: [], meta: { requestId: request.id } }
  );
  assert.deepEqual(
    await controller.listCustomColumns(projectId, headers, request),
    { data: [], meta: { requestId: request.id } }
  );
  assert.deepEqual(
    await controller.listCompetitors(
      projectId,
      { limit: "100", sources: "SERP,AI" },
      headers,
      request
    ),
    {
      data: [],
      page: { hasNext: false, totalApprox: 0 },
      meta: { requestId: request.id }
    }
  );
  assert.deepEqual(
    await controller.listPositionHistory(
      projectId,
      {
        limit: "25",
        observedFrom: "2026-01-01T00:00:00.000Z",
        observedBefore: "2026-08-20T00:00:00.000Z",
        searchEngines: "YANDEX,GOOGLE"
      },
      headers,
      request
    ),
    {
      data: [],
      page: { hasNext: false, totalApprox: 0 },
      meta: { requestId: request.id }
    }
  );
  assert.deepEqual(calls, [
    [
      "keywords",
      workspaceId,
      projectId,
      { limit: 500, search: "seo", sort: "CREATED_ASC" },
      request.id
    ],
    ["groups", workspaceId, projectId],
    ["columns", workspaceId, projectId],
    [
      "competitors",
      { workspaceId, projectId, actorId },
      { limit: 100, sort: "CREATED_DESC" },
      { sources: ["SERP", "AI"] },
      request.id
    ],
    [
      "position-history",
      { workspaceId, projectId, actorId },
      { limit: 25, sort: "CREATED_DESC" },
      {
        observedFrom: "2026-01-01T00:00:00.000Z",
        observedBefore: "2026-08-20T00:00:00.000Z",
        searchEngines: ["YANDEX", "GOOGLE"]
      },
      request.id
    ]
  ]);
});

test("rejects an export route outside the trusted project", async () => {
  const controller = new SemanticExportReadController(
    {} as KeywordService,
    {} as KeywordGroupService,
    {} as SemanticCustomColumnService,
    {} as SemanticPositionHistoryExportService,
    {} as SemanticCompetitorExportService
  );

  await assert.rejects(
    () =>
      controller.listKeywords(
        "01900000-0000-7000-8000-000000000099",
        {},
        headers,
        request
      ),
    BadRequestException
  );
});
