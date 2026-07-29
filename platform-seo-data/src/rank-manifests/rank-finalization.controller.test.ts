import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  GUARDS_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type { FastifyRequest } from "fastify";
import { RankExecutionApiGuard } from "../internal/rank-execution-api.guard.js";
import { RankFinalizationController } from "./rank-finalization.controller.js";
import type { RankFinalizationService } from "./rank-finalization.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const manifestId = "01900000-0000-7000-8000-000000000005";
const trackingContextId =
  "01900000-0000-7000-8000-000000000006";
const headers = {
  "x-workspace-id": workspaceId,
  "x-project-id": projectId,
  "x-actor-id": actorId
} as const;
const request = { id: "request-finalize-1" } as FastifyRequest;

test("protects rank finalization with dedicated rank auth", () => {
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, RankFinalizationController),
    [RankExecutionApiGuard]
  );
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, RankFinalizationController),
    "internal/v1/projects/:projectId/rank-manifests/:manifestId"
  );
  assert.equal(
    Reflect.getMetadata(
      PATH_METADATA,
      RankFinalizationController.prototype.finalize
    ),
    "finalize"
  );
});

test("finalizes only when route, body and trusted context match", async () => {
  let observed: unknown;
  const receipt = result();
  const controller = new RankFinalizationController({
    finalize: async (input: unknown) => {
      observed = input;
      return receipt;
    }
  } as unknown as RankFinalizationService);

  assert.deepEqual(
    await controller.finalize(
      projectId,
      manifestId,
      command(),
      headers,
      request
    ),
    {
      data: receipt,
      meta: { requestId: "request-finalize-1" }
    }
  );
  assert.deepEqual(observed, command());

  await assert.rejects(
    () =>
      controller.finalize(
        projectId,
        "01900000-0000-7000-8000-000000000099",
        command(),
        headers,
        request
      ),
    BadRequestException
  );
  await assert.rejects(
    () =>
      controller.finalize(
        projectId,
        manifestId,
        {
          ...command(),
          actorId: "01900000-0000-7000-8000-000000000099"
        },
        headers,
        request
      ),
    BadRequestException
  );
  await assert.rejects(
    () =>
      controller.finalize(
        "01900000-0000-7000-8000-000000000099",
        manifestId,
        command(),
        headers,
        request
      ),
    BadRequestException
  );
});

function command() {
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId,
    projectId,
    actorId,
    jobId,
    manifestId,
    status: "CANCELLED"
  } as const;
}

function result() {
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId,
    projectId,
    jobId,
    manifestId,
    requestHash: {
      algorithm: "SHA_256",
      value: "a".repeat(64)
    },
    trackingContextId,
    configurationVersion: 2,
    status: "CANCELLED",
    pairCount: "2",
    persistedCount: "0",
    foundCount: "0",
    notFoundCount: "0",
    missingCount: "2",
    finalizedAt: "2026-07-29T12:10:00.000Z"
  } as const;
}
