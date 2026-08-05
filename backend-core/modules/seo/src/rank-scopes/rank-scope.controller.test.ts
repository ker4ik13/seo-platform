import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { FastifyRequest } from "fastify";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import { RankScopeController } from "./rank-scope.controller.js";
import type { RankScopeService } from "./rank-scope.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const trackingContextId = "01900000-0000-7000-8000-000000000004";
const body = {
  workspaceId,
  projectId,
  actorId,
  trackingContextId
} as const;
const headers = {
  "x-workspace-id": workspaceId,
  "x-project-id": projectId,
  "x-actor-id": actorId
} as const;

test("protects the rank scope boundary with internal authentication", () => {
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, RankScopeController),
    [JobsApiGuard]
  );
});

test("requires route, body and trusted rank scope context to match", async () => {
  let observed: unknown;
  const result = {
    workspaceId,
    projectId,
    trackingContextId,
    contextStatus: "ACTIVE" as const,
    contextVersion: 1,
    configurationVersion: 1,
    configurationHash: "c".repeat(64),
    configuration: {
      searchEngine: "GOOGLE" as const,
      countryCode: "US",
      language: "en",
      device: "DESKTOP" as const,
      depth: 30 as const,
      domainMatchRule: { mode: "EXACT_HOST" as const },
      safeSearch: false
    },
    keywordCount: "0",
    contextCount: "1" as const,
    pairCount: "0",
    semanticScopeHash: {
      availability: "AVAILABLE" as const,
      algorithm: "SHA_256" as const,
      value: "a".repeat(64)
    },
    calculatedAt: "2026-07-29T12:00:00.000Z"
  };
  const controller = new RankScopeController({
    calculate: async (input: unknown) => {
      observed = input;
      return result;
    }
  } as unknown as RankScopeService);
  const request = { id: "request-1" } as FastifyRequest;

  assert.deepEqual(
    await controller.calculate(projectId, body, headers, request),
    { data: result, meta: { requestId: "request-1" } }
  );
  assert.deepEqual(observed, body);

  await assert.rejects(
    () =>
      controller.calculate(
        "01900000-0000-7000-8000-000000000099",
        body,
        headers,
        request
      ),
    BadRequestException
  );
  await assert.rejects(
    () =>
      controller.calculate(
        projectId,
        {
          ...body,
          workspaceId: "01900000-0000-7000-8000-000000000098"
        },
        headers,
        request
      ),
    BadRequestException
  );
});
