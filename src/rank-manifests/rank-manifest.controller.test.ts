import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { FastifyRequest } from "fastify";
import { RankExecutionApiGuard } from "../internal/rank-execution-api.guard.js";
import { RankManifestController } from "./rank-manifest.controller.js";
import type { RankManifestService } from "./rank-manifest.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const estimateId = "01900000-0000-7000-8000-000000000005";
const trackingContextId =
  "01900000-0000-7000-8000-000000000006";
const manifestId = "01900000-0000-7000-8000-000000000007";
const entryId = "01900000-0000-7000-8000-000000000008";
const assignmentId = "01900000-0000-7000-8000-000000000009";
const keywordId = "01900000-0000-7000-8000-000000000010";
const headers = {
  "x-workspace-id": workspaceId,
  "x-project-id": projectId,
  "x-actor-id": actorId
} as const;
const request = { id: "request-1" } as FastifyRequest;

test("protects both rank manifest endpoints with dedicated rank auth", () => {
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, RankManifestController),
    [RankExecutionApiGuard]
  );
});

test("seals only when route, body and trusted context match", async () => {
  let observed: unknown;
  const seal = sealResult();
  const controller = new RankManifestController({
    seal: async (input: unknown) => {
      observed = input;
      return seal;
    }
  } as unknown as RankManifestService);

  assert.deepEqual(
    await controller.seal(projectId, command(), headers, request),
    { data: seal, meta: { requestId: "request-1" } }
  );
  assert.deepEqual(observed, command());

  await assert.rejects(
    () =>
      controller.seal(
        "01900000-0000-7000-8000-000000000099",
        command(),
        headers,
        request
      ),
    BadRequestException
  );
  await assert.rejects(
    () =>
      controller.seal(
        projectId,
        {
          ...command(),
          actorId: "01900000-0000-7000-8000-000000000098"
        },
        headers,
        request
      ),
    BadRequestException
  );
});

test("reads a bounded chunk with job and tenant scope", async () => {
  let observed: unknown;
  const chunk = chunkResult();
  const controller = new RankManifestController({
    getChunk: async (input: unknown) => {
      observed = input;
      return chunk;
    }
  } as unknown as RankManifestService);

  assert.deepEqual(
    await controller.getChunk(
      projectId,
      manifestId,
      "0",
      { jobId },
      headers,
      request
    ),
    { data: chunk, meta: { requestId: "request-1" } }
  );
  assert.deepEqual(observed, {
    workspaceId,
    projectId,
    jobId,
    manifestId,
    chunkIndex: 0
  });

  await assert.rejects(
    () =>
      controller.getChunk(
        projectId,
        manifestId,
        "0",
        { jobId, workspaceId },
        headers,
        request
      ),
    BadRequestException
  );
});

function command() {
  return {
    workspaceId,
    projectId,
    actorId,
    jobId,
    estimateId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    estimate: {
      trackingContextId,
      contextVersion: 3,
      configurationVersion: 2,
      configurationHash: hash("a"),
      semanticScopeHash: hash("b"),
      scopeHash: hash("c"),
      pairCount: "1"
    },
    execution: {
      searchEngine: "GOOGLE",
      countryCode: "US",
      language: "en",
      device: "DESKTOP",
      depth: 30,
      domainMatchRule: { mode: "EXACT_HOST" },
      safeSearch: false,
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE",
      providerMappingVersion: "arsenkin-positions@1"
    },
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    }
  } as const;
}

function sealResult() {
  return {
    id: manifestId,
    workspaceId,
    projectId,
    jobId,
    estimateId,
    sealedBy: actorId,
    trackingContextId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: command().project,
    contextVersion: 3,
    configurationVersion: 2,
    configurationHash: hash("a"),
    semanticScopeHash: hash("b"),
    scopeHash: hash("c"),
    hashSchemaVersion: "rank-manifest@1",
    manifestHash: hash("d"),
    deduplicationHash: hash("e"),
    pairCount: "1",
    chunkCount: "1",
    chunkSize: "250",
    execution: command().execution,
    retention: command().retention,
    status: "SEALED",
    sealedAt: "2026-07-29T12:00:00.000Z"
  } as const;
}

function chunkResult() {
  return {
    workspaceId,
    projectId,
    jobId,
    manifestId,
    chunkIndex: 0,
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash: hash("f"),
    entries: [
      {
        id: entryId,
        sequence: 0,
        assignmentId,
        keywordId,
        keywordVersion: 1,
        keywordText: "seo tools",
        keywordTextHash: hash("1"),
        language: "en"
      }
    ]
  } as const;
}

function hash(value: string) {
  return {
    algorithm: "SHA_256",
    value: value.repeat(64)
  } as const;
}
