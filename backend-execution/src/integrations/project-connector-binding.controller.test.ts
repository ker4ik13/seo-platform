import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ProjectConnectorBindingController } from "./project-connector-binding.controller.js";
import type { ProjectConnectorBindingService } from "./project-connector-binding.service.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const projectId = "0190abcd-0000-7000-8000-000000000002";
const otherProjectId = "0190abcd-0000-7000-8000-000000000003";
const actorId = "0190abcd-0000-7000-8000-000000000004";

test("requires route, headers and command body to share one project scope", async () => {
  let aggregateCalls = 0;
  const service = {
    aggregate: async () => {
      aggregateCalls += 1;
      return {
        bindings: [],
        credentialOptions: [],
        credentialOptionsTruncated: false
      };
    }
  } as unknown as ProjectConnectorBindingService;
  const controller = new ProjectConnectorBindingController(service);
  const request = { id: "request-1" } as FastifyRequest;

  await assert.rejects(
    controller.aggregate(
      workspaceId,
      projectId,
      headers(otherProjectId),
      request
    ),
    BadRequestException
  );
  assert.equal(aggregateCalls, 0);

  await assert.rejects(
    controller.create(
      workspaceId,
      projectId,
      {
        workspaceId,
        projectId: otherProjectId,
        actorId,
        idempotencyKey: "binding-create-001",
        capability: "SERP_COLLECTION",
        enabled: true,
        route: {
          position: 0,
          sourceKind: "WORKSPACE_CREDENTIAL",
          credentialId: "0190abcd-0000-7000-8000-000000000005"
        },
        fallbackPolicy: { mode: "NONE" },
        budgetPolicy: { mode: "DISABLED" }
      },
      headers(projectId),
      request
    ),
    BadRequestException
  );
});

function headers(
  trustedProjectId: string
): Readonly<Record<string, string>> {
  return {
    "x-workspace-id": workspaceId,
    "x-project-id": trustedProjectId,
    "x-actor-id": actorId
  };
}
