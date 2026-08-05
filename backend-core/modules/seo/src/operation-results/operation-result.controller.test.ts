import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { FastifyRequest } from "fastify";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { OperationResultController } from "./operation-result.controller.js";
import type { OperationResultService } from "./operation-result.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const keywordId = "01900000-0000-7000-8000-000000000005";
const headers = {
  "x-workspace-id": workspaceId,
  "x-project-id": projectId,
  "x-actor-id": actorId
} as const;
const request = { id: "request-1" } as FastifyRequest;

test("protects all operation result projections with platform auth", () => {
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, OperationResultController),
    [PlatformApiGuard]
  );
});

test("rejects tenant or route mismatches before querying results", async () => {
  let calls = 0;
  const controller = new OperationResultController({
    frequency: async () => {
      calls += 1;
      throw new Error("must not run");
    },
    rank: async () => {
      calls += 1;
      throw new Error("must not run");
    }
  } as unknown as OperationResultService);

  await assert.rejects(
    () =>
      controller.frequency(
        projectId,
        jobId,
        headers,
        {
          workspaceId: "01900000-0000-7000-8000-000000000099",
          projectId,
          actorId,
          jobId,
          keywordIds: [keywordId]
        },
        request
      ),
    BadRequestException
  );
  await assert.rejects(
    () =>
      controller.rank(
        "01900000-0000-7000-8000-000000000098",
        jobId,
        headers,
        request
      ),
    BadRequestException
  );
  assert.equal(calls, 0);
});

test("normalizes crawl paging before delegating", async () => {
  let observed: unknown;
  const crawlId = "01900000-0000-7000-8000-000000000006";
  const result = {
    workspaceId,
    projectId,
    crawlId,
    rows: [],
    page: { hasNext: false }
  };
  const controller = new OperationResultController({
    crawl: async (...args: unknown[]) => {
      observed = args;
      return result;
    }
  } as unknown as OperationResultService);

  assert.deepEqual(
    await controller.crawl(
      projectId,
      crawlId,
      "25",
      "10",
      headers,
      request
    ),
    { data: result, meta: { requestId: "request-1" } }
  );
  assert.deepEqual(observed, [
    { workspaceId, projectId, actorId },
    crawlId,
    25,
    10
  ]);
});
