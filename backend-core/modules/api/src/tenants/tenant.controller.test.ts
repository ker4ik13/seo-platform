import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary } from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { TenantController } from "./tenant.controller.js";
import type { TenantService } from "./tenant.service.js";
import type { ProjectLogoService } from "./project-logo.service.js";
import type { JobsClient } from "../jobs/jobs.client.js";

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
  const controller = new TenantController(
    {
      getProject: async (projectId: string) => {
        requestedIds.push(projectId);
        return project;
      }
    } as unknown as TenantService,
    {} as ProjectLogoService
  );
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

test("adds active operation counts only to projects visible to the member", async () => {
  const controller = new TenantController(
    {
      listProjects: async () => [project]
    } as unknown as TenantService,
    {} as ProjectLogoService,
    {
      listProjectOperationActivity: async () =>
        new Map([
          [project.id, 2],
          ["01900000-0000-7000-8000-000000000199", 8]
        ])
    } as unknown as JobsClient
  );
  const request = {
    id: "request-project-list",
    headers: {},
    ip: "127.0.0.1",
    tenantAuthorization: {
      workspaceId: project.workspaceId,
      workspaceStatus: "ACTIVE",
      roleCode: "OWNER"
    }
  } as TenantRequest;

  const response = await controller.projects(request, {
    userId: project.ownerUserId
  } as AuthenticatedPrincipal);

  assert.deepEqual(response.data, [{ ...project, activeOperationCount: 2 }]);
});

test("filters a workspace project list by the API token allowlist", async () => {
  const second = {
    ...project,
    id: "01900000-0000-7000-8000-000000000104",
    slug: "second",
    name: "Second"
  };
  const controller = new TenantController(
    {
      listProjects: async () => [project, second]
    } as unknown as TenantService,
    {} as ProjectLogoService
  );
  const request = {
    id: "request-token-project-list",
    headers: {},
    ip: "127.0.0.1",
    tenantAuthorization: {
      workspaceId: project.workspaceId,
      workspaceStatus: "ACTIVE",
      roleCode: "OWNER"
    },
    apiTokenAuthorization: {
      tokenId: "01900000-0000-7000-8000-000000000105",
      workspaceId: project.workspaceId,
      name: "Agent",
      scopes: ["projects:read"],
      allProjects: false,
      projectIds: [project.id]
    }
  } as unknown as TenantRequest;

  const response = await controller.projects(request, {
    userId: project.ownerUserId
  } as AuthenticatedPrincipal);

  assert.deepEqual(response.data, [project]);
});

test("returns an authoritative activity projection only for visible projects", async () => {
  const hiddenProjectId = "01900000-0000-7000-8000-000000000199";
  const controller = new TenantController(
    {
      listProjects: async () => [project]
    } as unknown as TenantService,
    {} as ProjectLogoService,
    {
      listProjectOperationActivity: async () =>
        new Map([
          [project.id, 3],
          [hiddenProjectId, 9]
        ])
    } as unknown as JobsClient
  );
  const request = {
    id: "request-operation-projection",
    headers: {},
    ip: "127.0.0.1",
    tenantAuthorization: {
      workspaceId: project.workspaceId,
      workspaceStatus: "ACTIVE",
      roleCode: "OWNER"
    }
  } as TenantRequest;

  const response = await controller.projectOperationActivity(request, {
    userId: project.ownerUserId
  } as AuthenticatedPrincipal);

  assert.deepEqual(response.data.projects, [
    { projectId: project.id, activeOperationCount: 3 }
  ]);
});
