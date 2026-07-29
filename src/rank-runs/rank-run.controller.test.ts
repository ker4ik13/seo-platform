import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  HTTP_CODE_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type { RankJobSummary } from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { IntegrationCredentialApiGuard } from "../integrations/integration-credential-api.guard.js";
import { RankRunController } from "./rank-run.controller.js";
import type { RankRunService } from "./rank-run.service.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const projectId = "0190abcd-0000-7000-8000-000000000002";
const otherProjectId = "0190abcd-0000-7000-8000-000000000003";
const actorId = "0190abcd-0000-7000-8000-000000000004";
const estimateId = "0190abcd-0000-7000-8000-000000000005";
const membershipId = "0190abcd-0000-7000-8000-000000000006";
const jobId = "0190abcd-0000-7000-8000-000000000007";

test("declares the dedicated internal guard and exact route boundary", () => {
  const prototype = RankRunController.prototype;

  assert.deepEqual(
    Reflect.getMetadata("__guards__", RankRunController),
    [IntegrationCredentialApiGuard]
  );
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, RankRunController),
    "internal/v1/workspaces/:workspaceId/projects/:projectId"
  );
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, prototype.create),
    "rank-runs"
  );
  assert.equal(
    Reflect.getMetadata(HTTP_CODE_METADATA, prototype.create),
    202
  );
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, prototype.get),
    "jobs/:jobId"
  );
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, prototype.cancel),
    "jobs/:jobId/cancel"
  );
});

test("accepts only an exact body matching route and trusted headers", async () => {
  const calls: unknown[][] = [];
  const service = {
    create: async (...args: unknown[]) => {
      calls.push(args);
      return preparingSummary();
    }
  } as unknown as RankRunService;
  const controller = new RankRunController(service);
  const responseHeaders = new Map<string, string>();
  const response = {
    header: (name: string, value: string) => {
      responseHeaders.set(name, value);
      return response;
    }
  } as unknown as FastifyReply;
  const request = { id: "request-rank-run-1" } as FastifyRequest;

  const created = await controller.create(
    workspaceId,
    projectId,
    headers(),
    "rank-run-idempotency-0001",
    body(),
    request,
    response
  );

  assert.equal(created.data.id, jobId);
  assert.equal(created.meta.requestId, request.id);
  assert.equal(
    responseHeaders.get("Location"),
    `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/jobs/${jobId}`
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(1), [
    "rank-run-idempotency-0001",
    request.id
  ]);

  await assert.rejects(
    controller.create(
      workspaceId,
      otherProjectId,
      headers(),
      "rank-run-idempotency-0002",
      body(),
      request,
      response
    ),
    BadRequestException
  );
  await assert.rejects(
    controller.create(
      workspaceId,
      projectId,
      headers(),
      "rank-run-idempotency-0003",
      { ...body(), unexpected: true },
      request,
      response
    ),
    BadRequestException
  );
  assert.equal(calls.length, 1);
});

test("requires the cancel route Job identifier to match the exact command", async () => {
  let cancelCalls = 0;
  const service = {
    cancel: async () => {
      cancelCalls += 1;
      return preparingSummary();
    }
  } as unknown as RankRunService;
  const controller = new RankRunController(service);
  const request = { id: "request-rank-cancel-1" } as FastifyRequest;

  await assert.rejects(
    controller.cancel(
      workspaceId,
      projectId,
      jobId,
      headers(),
      {
        workspaceId,
        projectId,
        actorId,
        jobId: estimateId
      },
      request
    )
  );
  assert.equal(cancelCalls, 0);
});

function headers(): Readonly<Record<string, string>> {
  return {
    "x-workspace-id": workspaceId,
    "x-project-id": projectId,
    "x-actor-id": actorId
  };
}

function body(): Readonly<Record<string, unknown>> {
  return {
    workspaceId,
    projectId,
    actorId,
    estimateId,
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    access: {
      workspaceStatus: "ACTIVE",
      membershipId,
      membershipVersion: 3,
      canRunRanking: true,
      entitlementStatus: "ALLOWED",
      quota: {
        status: "AVAILABLE",
        limit: "10",
        used: "0",
        remaining: "10"
      }
    },
    billingCurrency: "RUB"
  };
}

function preparingSummary(): RankJobSummary {
  return {
    id: jobId,
    workspaceId,
    projectId,
    trackingContextId: "0190abcd-0000-7000-8000-000000000008",
    type: "MANUAL_RANK_CHECK",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    progress: {
      current: "0",
      total: "3",
      unit: "KEYWORD"
    },
    platformChargeMicro: "0",
    billingCurrency: "RUB",
    status: "PREPARING",
    stage: "PREPARING_SCOPE",
    createdAt: "2026-07-29T12:00:00.000Z"
  };
}
