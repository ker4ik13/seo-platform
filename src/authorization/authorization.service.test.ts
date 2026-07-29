import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { DomainError } from "../common/domain-error.js";
import { AuthorizationService } from "./authorization.service.js";

const userId = "01900000-0000-7000-8000-000000000001";
const workspaceId = "01900000-0000-7000-8000-000000000002";
const projectId = "01900000-0000-7000-8000-000000000003";
const membershipId = "01900000-0000-7000-8000-000000000004";

test("carries authoritative workspace and project lifecycle into tenant context", async () => {
  const service = new AuthorizationService(
    prisma({
      workspaceStatus: "ACTIVE",
      projectStatus: "ARCHIVED"
    })
  );

  const tenant = await service.forProject(
    userId,
    projectId,
    "integration.view"
  );

  assert.deepEqual(tenant, {
    workspaceId,
    workspaceStatus: "ACTIVE",
    projectId,
    projectStatus: "ARCHIVED",
    roleCode: "OWNER",
    membershipId,
    membershipVersion: 3
  });
});

test("keeps reads available and blocks mutations for a read-only workspace", async () => {
  const service = new AuthorizationService(
    prisma({
      workspaceStatus: "READ_ONLY",
      projectStatus: "ACTIVE"
    })
  );

  assert.equal(
    (
      await service.forProject(
        userId,
        projectId,
        "integration.view"
      )
    ).workspaceStatus,
    "READ_ONLY"
  );
  await assert.rejects(
    service.forProject(
      userId,
      projectId,
      "integration.update"
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.statusCode === 402 &&
      error.code === "PAYMENT_REQUIRED"
  );
});

function prisma(input: {
  readonly workspaceStatus: "ACTIVE" | "READ_ONLY";
  readonly projectStatus: "ACTIVE" | "ARCHIVED";
}): PrismaService {
  return {
    project: {
      findUnique: async () => ({
        id: projectId,
        workspaceId,
        status: input.projectStatus
      })
    },
    workspaceMember: {
      findUnique: async () => ({
        id: membershipId,
        workspaceId,
        userId,
        status: "ACTIVE",
        roleCode: "OWNER",
        allProjects: true,
        version: 3,
        workspace: {
          id: workspaceId,
          status: input.workspaceStatus
        },
        projectAccesses: []
      })
    }
  } as unknown as PrismaService;
}
