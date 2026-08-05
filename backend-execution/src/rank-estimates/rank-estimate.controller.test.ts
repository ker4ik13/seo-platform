import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { IntegrationCredentialApiGuard } from "../integrations/integration-credential-api.guard.js";
import { RankEstimateController } from "./rank-estimate.controller.js";
import type { RankEstimateService } from "./rank-estimate.service.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const projectId = "0190abcd-0000-7000-8000-000000000002";
const actorId = "0190abcd-0000-7000-8000-000000000003";
const trackingContextId = "0190abcd-0000-7000-8000-000000000004";

test("is protected by the dedicated credential-capable caller guard", () => {
  assert.deepEqual(
    Reflect.getMetadata("__guards__", RankEstimateController),
    [IntegrationCredentialApiGuard]
  );
});

test("requires route, trusted headers and project snapshot to share one tenant", async () => {
  let calls = 0;
  const service = {
    create: async () => {
      calls += 1;
      throw new Error("must not reach service");
    }
  } as unknown as RankEstimateService;
  const controller = new RankEstimateController(service);
  const request = { id: "request-1" } as FastifyRequest;

  await assert.rejects(
    controller.create(
      workspaceId,
      projectId,
      {
        "x-workspace-id": workspaceId,
        "x-project-id": actorId,
        "x-actor-id": actorId
      },
      "rank-estimate-0001",
      body(),
      request
    ),
    BadRequestException
  );
  await assert.rejects(
    controller.create(
      workspaceId,
      projectId,
      headers(),
      "rank-estimate-0001",
      body({ projectId: actorId }),
      request
    ),
    BadRequestException
  );
  assert.equal(calls, 0);
});

function headers(): Readonly<Record<string, string>> {
  return {
    "x-workspace-id": workspaceId,
    "x-project-id": projectId,
    "x-actor-id": actorId
  };
}

function body(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    workspaceId,
    projectId,
    actorId,
    trackingContextId,
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 1
    },
    access: {
      workspaceStatus: "ACTIVE",
      canRunRanking: true,
      entitlementStatus: "NOT_AVAILABLE"
    },
    billingCurrency: "RUB",
    quota: { status: "NOT_AVAILABLE" },
    ...overrides
  };
}
