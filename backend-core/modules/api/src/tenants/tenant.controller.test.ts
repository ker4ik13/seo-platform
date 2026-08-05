import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary } from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { TenantController } from "./tenant.controller.js";
import type { TenantService } from "./tenant.service.js";

const project: ProjectSummary = {
  id: "01900000-0000-7000-8000-000000000101",
  workspaceId: "01900000-0000-7000-8000-000000000102",
  name: "Project",
  slug: "project",
  domain: "example.test",
  locale: "ru",
  timezone: "Europe/Moscow",
  status: "ACTIVE",
  ownerUserId: "01900000-0000-7000-8000-000000000103",
  version: 4,
  createdAt: "2026-07-30T12:00:00.000Z"
};

test("explicit project response carries the authorized project access level", async () => {
  const requestedIds: string[] = [];
  const controller = new TenantController({
    getProject: async (projectId: string) => {
      requestedIds.push(projectId);
      return project;
    }
  } as TenantService);
  const responseHeaders = new Map<string, string>();
  const reply = {
    header: (name: string, value: string) => {
      responseHeaders.set(name, value);
      return reply;
    }
  } as unknown as FastifyReply;
  const request = {
    id: "request-id",
    tenantAuthorization: {
      workspaceId: project.workspaceId,
      workspaceStatus: "ACTIVE",
      projectId: project.id,
      projectStatus: "ACTIVE",
      roleCode: "OWNER",
      projectAccessLevel: "VIEWER"
    }
  } as TenantRequest;

  const response = await controller.project(request, reply);

  assert.deepEqual(requestedIds, [project.id]);
  assert.equal(response.data.projectAccessLevel, "VIEWER");
  assert.equal(responseHeaders.get("ETag"), '"v4"');
});
