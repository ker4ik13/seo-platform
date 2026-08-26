import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { FastifyRequest } from "fastify";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { KeywordController } from "./keyword.controller.js";
import type { KeywordService } from "./keyword.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";
const headers = {
  "x-workspace-id": workspaceId,
  "x-project-id": projectId,
  "x-actor-id": actorId
} as const;
const request = { id: "request-keyword-bulk" } as FastifyRequest;

test("protects keyword commands with the platform API boundary", () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, KeywordController), [
    PlatformApiGuard
  ]);
});

test("forwards an exact tenant-scoped keyword bulk create", async () => {
  let observed: unknown;
  const result = {
    selected: 1,
    created: 1,
    restored: 0,
    linked: 0,
    skipped: 0,
    rejected: 0,
    failed: 0,
    rows: [
      {
        index: 0,
        outcome: "CREATED" as const,
        keywordId,
        version: 1
      }
    ]
  };
  const controller = new KeywordController({
    bulkCreate: async (input: unknown) => {
      observed = input;
      return result;
    }
  } as unknown as KeywordService);
  const body = command();

  assert.deepEqual(
    await controller.bulkCreate(projectId, body, headers, request),
    { data: result, meta: { requestId: request.id } }
  );
  assert.deepEqual(observed, {
    ...body,
    items: [{ ...body.items[0], isTracked: true }]
  });

  await assert.rejects(
    () =>
      controller.bulkCreate(
        "01900000-0000-7000-8000-000000000099",
        body,
        headers,
        request
      ),
    BadRequestException
  );
});

test("forwards a read-only duplicate preview in the trusted scope", async () => {
  let observed: unknown;
  const result = {
    selected: 1,
    newKeywords: 1,
    activeDuplicates: 0,
    trashedDuplicates: 0,
    restorableDeleted: 0,
    rows: [
      {
        index: 0,
        state: "NEW" as const,
        groups: [],
        groupsTruncated: false,
        inTargetGroup: false
      }
    ]
  };
  const controller = new KeywordController({
    previewBulkCreate: async (input: unknown) => {
      observed = input;
      return result;
    }
  } as unknown as KeywordService);
  const body = {
    workspaceId,
    projectId,
    actorId,
    items: [{ text: "SEO аудит", language: "ru" }]
  };

  assert.deepEqual(
    await controller.previewBulkCreate(projectId, body, headers, request),
    { data: result, meta: { requestId: request.id } }
  );
  assert.deepEqual(observed, body);
});

test("forwards normalized tag suggestions inside the trusted project scope", async () => {
  let observed: unknown;
  const controller = new KeywordController({
    tagOptions: async (
      observedWorkspaceId: string,
      observedProjectId: string,
      search?: string
    ) => {
      observed = { observedWorkspaceId, observedProjectId, search };
      return ["Бренд"];
    }
  } as unknown as KeywordService);

  assert.deepEqual(
    await controller.tagOptions(
      projectId,
      { search: "  БРЕНД  " },
      headers,
      request
    ),
    { data: ["Бренд"], meta: { requestId: request.id } }
  );
  assert.deepEqual(observed, {
    observedWorkspaceId: workspaceId,
    observedProjectId: projectId,
    search: "бренд"
  });
});

function command() {
  return {
    workspaceId,
    projectId,
    actorId,
    entitlement: {
      planCode: "PRO",
      planVersion: 1,
      storedKeywords: 10_000,
      keywordsPerProject: 5_000,
      foldersPerProject: 200,
      trackedContextPairs: 5_000
    },
    duplicatePolicy: "SKIP_EXISTING",
    items: [
      {
        text: "SEO аудит",
        language: "ru",
        priority: 0,
        isFavorite: false,
        tagNames: []
      }
    ]
  } as const;
}
