import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA
} from "@nestjs/common/constants.js";
import type {
  ProjectConnectorBinding,
  ProjectConnectorBindingsAggregate
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import type { AuditRecord } from "../audit/audit.service.js";
import { AuditService } from "../audit/audit.service.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type {
  AuthorizedProjectStatus,
  AuthorizedWorkspaceStatus,
  TenantRequest
} from "../authorization/authorization.types.js";
import { DomainError } from "../common/domain-error.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { ProjectIntegrationController } from "./project-integration.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const bindingId = "01900000-0000-7000-8000-000000000004";
const credentialId = "01900000-0000-7000-8000-000000000005";
const routeId = "01900000-0000-7000-8000-000000000006";
const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000007",
  sessionFamilyId: "01900000-0000-7000-8000-000000000008",
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 900_000)
};
const binding: ProjectConnectorBinding = {
  id: bindingId,
  workspaceId,
  projectId,
  capability: "SERP_RANK_TRACKING",
  enabled: true,
  route: {
    id: routeId,
    bindingId,
    workspaceId,
    projectId,
    position: 0,
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId,
    provider: "ARSENKIN",
    credentialMode: "BYOK_API_KEY",
    createdAt: "2026-07-29T09:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z"
  },
  fallbackPolicy: { mode: "NONE" },
  budgetPolicy: { mode: "DISABLED" },
  availability: "READY",
  version: 1,
  createdBy: actorId,
  updatedBy: actorId,
  createdAt: "2026-07-29T09:00:00.000Z",
  updatedAt: "2026-07-29T09:00:00.000Z"
};
const aggregate: ProjectConnectorBindingsAggregate = {
  bindings: [binding],
  credentialOptions: [
    {
      id: credentialId,
      workspaceId,
      provider: "ARSENKIN",
      label: "Primary",
      mode: "BYOK_API_KEY",
      status: "ACTIVE",
      capabilities: ["SERP_RANK_TRACKING"]
    }
  ],
  credentialOptionsTruncated: false
};
const createInput = {
  capability: "SERP_RANK_TRACKING",
  enabled: true,
  route: {
    position: 0,
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId
  },
  fallbackPolicy: { mode: "NONE" },
  budgetPolicy: { mode: "DISABLED" }
} as const;

test("declares separate read and mutation permission boundaries", () => {
  const prototype = ProjectIntegrationController.prototype;
  assert.equal(
    Reflect.getMetadata(REQUIRED_PERMISSION, prototype.get),
    "integration.view"
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, prototype.get),
    [SessionAuthGuard, TenantPermissionGuard]
  );
  assert.equal(
    Reflect.getMetadata(REQUIRED_PERMISSION, prototype.create),
    "integration.update"
  );
  assert.deepEqual(
    Reflect.getMetadata(GUARDS_METADATA, prototype.create),
    [CsrfSessionGuard, TenantPermissionGuard]
  );
  assert.equal(
    Reflect.getMetadata(HTTP_CODE_METADATA, prototype.create),
    201
  );
  assert.equal(
    Reflect.getMetadata(REQUIRED_PERMISSION, prototype.update),
    "integration.update"
  );
});

test("projects effective access for active, read-only, archived and missing-permission contexts", async () => {
  const controller = controllerWith({
    projectConnectorBindings: async () => aggregate
  });
  const cases = [
    {
      request: tenantRequest(),
      restriction: "NONE",
      canUpdate: true
    },
    {
      request: tenantRequest({ workspaceStatus: "READ_ONLY" }),
      restriction: "WORKSPACE_READ_ONLY",
      canUpdate: false
    },
    {
      request: tenantRequest({ projectStatus: "ARCHIVED" }),
      restriction: "PROJECT_ARCHIVED",
      canUpdate: false
    },
    {
      request: tenantRequest({ roleCode: "SEO_LEAD" }),
      restriction: "MISSING_PERMISSION",
      canUpdate: false
    }
  ] as const;

  for (const candidate of cases) {
    const response = await controller.get(candidate.request, principal);
    assert.equal(
      response.data.access.mutationRestriction,
      candidate.restriction
    );
    assert.equal(
      response.data.access.canUpdateBindings,
      candidate.canUpdate
    );
  }
});

test("creates and updates through trusted project context with audit and entity versions", async () => {
  const calls: Array<{
    readonly method: string;
    readonly args: readonly unknown[];
  }> = [];
  const audit: AuditRecord[] = [];
  const controller = controllerWith(
    {
      createProjectConnectorBinding: async (...args: unknown[]) => {
        calls.push({ method: "create", args });
        return binding;
      },
      updateProjectConnectorBinding: async (...args: unknown[]) => {
        calls.push({ method: "update", args });
        return { ...binding, version: 2 };
      }
    },
    audit
  );
  const createReply = reply();
  const updateReply = reply();

  const created = await controller.create(
    createInput,
    tenantRequest({
      headers: { "idempotency-key": "project-binding-create-001" }
    }),
    createReply.value,
    principal
  );
  const updated = await controller.update(
    bindingId.toUpperCase(),
    {
      enabled: false,
      route: createInput.route,
      fallbackPolicy: createInput.fallbackPolicy,
      budgetPolicy: createInput.budgetPolicy
    },
    tenantRequest({ headers: { "if-match": "\"v1\"" } }),
    updateReply.value,
    principal
  );

  assert.equal(created.meta.version, 1);
  assert.equal(updated.meta.version, 2);
  assert.equal(createReply.headers.get("etag"), "\"v1\"");
  assert.equal(updateReply.headers.get("etag"), "\"v2\"");
  assert.equal(calls[0]?.args[2], "project-binding-create-001");
  assert.equal(calls[1]?.args[1], bindingId);
  assert.equal(calls[1]?.args[3], 1);
  assert.deepEqual(calls[0]?.args[0], {
    tenant: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "OWNER"
    },
    actorId,
    requestId: "request-project-integration-001"
  });
  assert.deepEqual(
    audit.map(({ action, outcome, projectId: auditedProjectId }) => [
      action,
      outcome,
      auditedProjectId
    ]),
    [
      [
        "integration.project_connector_binding.create_requested",
        "REQUESTED",
        projectId
      ],
      [
        "integration.project_connector_binding.created",
        "SUCCESS",
        projectId
      ],
      [
        "integration.project_connector_binding.update_requested",
        "REQUESTED",
        projectId
      ],
      [
        "integration.project_connector_binding.updated",
        "SUCCESS",
        projectId
      ]
    ]
  );
});

test("does not report a committed CAS update as failed when its success audit is unavailable", async () => {
  let auditCalls = 0;
  const response = reply();
  const controller = new ProjectIntegrationController(
    {
      updateProjectConnectorBinding: async () => ({
        ...binding,
        version: 2
      })
    } as unknown as JobsClient,
    {
      record: async () => {
        auditCalls += 1;
        if (auditCalls === 2) {
          throw new Error("audit unavailable");
        }
      }
    } as unknown as AuditService
  );
  silenceControllerLogger(controller);

  const result = await controller.update(
    bindingId,
    {
      enabled: false,
      route: createInput.route,
      fallbackPolicy: createInput.fallbackPolicy,
      budgetPolicy: createInput.budgetPolicy
    },
    tenantRequest({ headers: { "if-match": "\"v1\"" } }),
    response.value,
    principal
  );

  assert.equal(result.meta.version, 2);
  assert.equal(response.headers.get("etag"), "\"v2\"");
  assert.equal(auditCalls, 2);
});

test("returns a committed idempotent create when its success audit is unavailable", async () => {
  let jobsCalls = 0;
  let auditCalls = 0;
  const response = reply();
  const controller = new ProjectIntegrationController(
    {
      createProjectConnectorBinding: async () => {
        jobsCalls += 1;
        return binding;
      }
    } as unknown as JobsClient,
    {
      record: async () => {
        auditCalls += 1;
        if (auditCalls === 2) {
          throw new Error("audit unavailable");
        }
      }
    } as unknown as AuditService
  );
  silenceControllerLogger(controller);

  const result = await controller.create(
    createInput,
    tenantRequest({
      headers: { "idempotency-key": "project-binding-create-001" }
    }),
    response.value,
    principal
  );

  assert.equal(result.meta.version, 1);
  assert.equal(response.headers.get("etag"), "\"v1\"");
  assert.equal(jobsCalls, 1);
  assert.equal(auditCalls, 2);
});

test("keeps requested audit fail-closed before calling Jobs", async () => {
  let jobsCalls = 0;
  const controller = new ProjectIntegrationController(
    {
      createProjectConnectorBinding: async () => {
        jobsCalls += 1;
        return binding;
      }
    } as unknown as JobsClient,
    {
      record: async () => {
        throw new Error("audit unavailable");
      }
    } as unknown as AuditService
  );

  await assert.rejects(
    controller.create(
      createInput,
      tenantRequest({
        headers: { "idempotency-key": "project-binding-create-001" }
      }),
      reply().value,
      principal
    ),
    /audit unavailable/
  );
  assert.equal(jobsCalls, 0);
});

test("rejects workspace credentials without their dedicated permission before audit and Jobs", async () => {
  let dependencyCalled = false;
  const controller = new ProjectIntegrationController(
    {
      createProjectConnectorBinding: async () => {
        dependencyCalled = true;
        return binding;
      }
    } as unknown as JobsClient,
    {
      record: async () => {
        dependencyCalled = true;
      }
    } as unknown as AuditService
  );

  await assert.rejects(
    controller.create(
      createInput,
      tenantRequest({
        roleCode: "ANALYST",
        headers: { "idempotency-key": "project-binding-create-001" }
      }),
      reply().value,
      principal
    ),
    (error: unknown) =>
      error instanceof Error &&
      "getStatus" in error &&
      typeof error.getStatus === "function" &&
      error.getStatus() === 403
  );
  assert.equal(dependencyCalled, false);
});

test("rejects archived mutations before idempotency, audit and jobs", async () => {
  let dependencyCalled = false;
  const controller = new ProjectIntegrationController(
    {
      createProjectConnectorBinding: async () => {
        dependencyCalled = true;
        return binding;
      }
    } as unknown as JobsClient,
    {
      record: async () => {
        dependencyCalled = true;
      }
    } as unknown as AuditService
  );

  await assert.rejects(
    controller.create(
      createInput,
      tenantRequest({
        projectStatus: "ARCHIVED",
        headers: {}
      }),
      reply().value,
      principal
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.statusCode === 409 &&
      error.code === "RESOURCE_STATE_CONFLICT"
  );
  assert.equal(dependencyCalled, false);
});

test("requires idempotency and version preconditions before audit and jobs", async () => {
  let dependencyCalled = false;
  const controller = new ProjectIntegrationController(
    {
      createProjectConnectorBinding: async () => {
        dependencyCalled = true;
        return binding;
      },
      updateProjectConnectorBinding: async () => {
        dependencyCalled = true;
        return binding;
      }
    } as unknown as JobsClient,
    {
      record: async () => {
        dependencyCalled = true;
      }
    } as unknown as AuditService
  );

  await assert.rejects(
    controller.create(
      createInput,
      tenantRequest({ headers: {} }),
      reply().value,
      principal
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "VALIDATION_FAILED"
  );
  await assert.rejects(
    controller.update(
      bindingId,
      {
        enabled: false,
        route: createInput.route,
        fallbackPolicy: createInput.fallbackPolicy,
        budgetPolicy: createInput.budgetPolicy
      },
      tenantRequest({ headers: {} }),
      reply().value,
      principal
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.statusCode === 428 &&
      error.code === "VERSION_CONFLICT"
  );
  assert.equal(dependencyCalled, false);
});

function controllerWith(
  jobs: Partial<JobsClient>,
  records: AuditRecord[] = []
): ProjectIntegrationController {
  return new ProjectIntegrationController(
    jobs as JobsClient,
    {
      record: async (record: AuditRecord) => {
        records.push(record);
      }
    } as unknown as AuditService
  );
}

function tenantRequest(
  options: Readonly<{
    workspaceStatus?: AuthorizedWorkspaceStatus;
    projectStatus?: AuthorizedProjectStatus;
    roleCode?: string;
    headers?: Readonly<Record<string, string>>;
  }> = {}
): TenantRequest {
  return {
    id: "request-project-integration-001",
    headers: options.headers ?? {},
    tenantAuthorization: {
      workspaceId,
      workspaceStatus: options.workspaceStatus ?? "ACTIVE",
      projectId,
      projectStatus: options.projectStatus ?? "ACTIVE",
      roleCode: options.roleCode ?? "OWNER"
    }
  } as unknown as TenantRequest;
}

function reply(): {
  readonly value: FastifyReply;
  readonly headers: Map<string, string>;
} {
  const responseHeaders = new Map<string, string>();
  return {
    value: {
      header: (name: string, value: string) => {
        responseHeaders.set(name.toLowerCase(), value);
      }
    } as unknown as FastifyReply,
    headers: responseHeaders
  };
}

function silenceControllerLogger(
  controller: ProjectIntegrationController
): void {
  (
    controller as unknown as {
      logger: { error: (message: string) => void };
    }
  ).logger = { error: () => undefined };
}
