import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type {
  AutomationRunSummary,
  RankTrackingAutomationSummary
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import type {
  AuditRecord,
  AuditService
} from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { DomainError } from "../common/domain-error.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import type { JobsClient } from "../jobs/jobs.client.js";
import type { TenantService } from "../tenants/tenant.service.js";
import { AutomationController } from "./automation.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const membershipId = "01900000-0000-7000-8000-000000000004";
const automationId = "01900000-0000-7000-8000-000000000005";
const contextId = "01900000-0000-7000-8000-000000000006";
const runId = "01900000-0000-7000-8000-000000000007";

const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000008",
  sessionFamilyId: "01900000-0000-7000-8000-000000000009",
  authenticatedAt: new Date("2026-07-31T09:00:00.000Z"),
  expiresAt: new Date("2026-07-31T11:00:00.000Z")
};

const summary: RankTrackingAutomationSummary = {
  id: automationId,
  workspaceId,
  projectId,
  name: "Ночной съём",
  trackingContextId: contextId,
  timezone: "Europe/Moscow",
  schedule: { cadence: "DAILY", hour: 2, minute: 0 },
  maxItems: 500,
  failureThreshold: 3,
  enabled: true,
  nextRunAt: "2026-08-01T23:00:00.000Z",
  consecutiveErrors: 0,
  version: 1,
  createdAt: "2026-07-31T10:00:00.000Z",
  updatedAt: "2026-07-31T10:00:00.000Z"
};

const run: AutomationRunSummary = {
  id: runId,
  automationId,
  automationVersion: 1,
  workspaceId,
  projectId,
  status: "RUNNING",
  trigger: "MANUAL",
  scheduledFor: "2026-07-31T10:05:00.000Z",
  startedAt: "2026-07-31T10:05:00.000Z",
  createdAt: "2026-07-31T10:05:00.000Z"
};

const createInput = {
  name: "Ночной съём",
  trackingContextId: contextId,
  timezone: "Europe/Moscow",
  schedule: { cadence: "DAILY", hour: 2, minute: 0 },
  maxItems: 500,
  failureThreshold: 3,
  enabled: true
} as const;

test("declares exact automation permissions, guards and response codes", () => {
  const prototype = AutomationController.prototype;

  assert.equal(
    Reflect.getMetadata(PATH_METADATA, AutomationController),
    "api/v1/projects/:projectId/automations"
  );
  assertRoute(prototype.list, "automation.view", [
    SessionAuthGuard,
    TenantPermissionGuard
  ]);
  assertRoute(prototype.listRuns, "automation.view", [
    SessionAuthGuard,
    TenantPermissionGuard
  ]);
  assertRoute(prototype.create, "automation.manage", [
    CsrfSessionGuard,
    TenantPermissionGuard
  ]);
  assertRoute(prototype.update, "automation.manage", [
    CsrfSessionGuard,
    TenantPermissionGuard
  ]);
  assertRoute(
    prototype.run,
    "automation.enable",
    [CsrfSessionGuard, TenantPermissionGuard],
    202
  );
  assertRoute(
    prototype.pause,
    "automation.enable",
    [CsrfSessionGuard, TenantPermissionGuard],
    200
  );
  assertRoute(
    prototype.resume,
    "automation.enable",
    [CsrfSessionGuard, TenantPermissionGuard],
    200
  );
});

test("keeps expired-plan capacity readable without authorizing a mutation", async () => {
  let readCapacityCalls = 0;
  const controller = controllerWith({
    jobs: {
      listAutomations: async (_context: unknown, limit: number) => ({
        automations: [summary],
        enabledCount: 1,
        limit,
        truncated: false
      })
    },
    billing: {
      automationCapacityForRead: async () => {
        readCapacityCalls += 1;
        return {
          planCode: "TEAM",
          planVersion: 7,
          scheduledAutomations: 10
        };
      },
      automationCapacity: async () => {
        throw new Error("mutation capacity must not be read");
      }
    }
  });

  const response = await controller.list(
    request({ workspaceStatus: "READ_ONLY" }),
    principal
  );

  assert.equal(response.data.limit, 10);
  assert.equal(response.data.automations[0]?.id, automationId);
  assert.equal(response.data.access.canManage, false);
  assert.equal(
    response.data.access.mutationRestriction,
    "WORKSPACE_READ_ONLY"
  );
  assert.equal(readCapacityCalls, 1);
});

test("creates from authoritative tenant, billing and BYOK snapshots", async () => {
  let captured: readonly unknown[] | undefined;
  const records: AuditRecord[] = [];
  const response = reply();
  const controller = controllerWith({
    jobs: {
      createAutomation: async (...args: unknown[]) => {
        captured = args;
        return summary;
      }
    },
    records
  });

  const created = await controller.create(
    createInput,
    request({
      headers: { "idempotency-key": "rank-automation-create-001" }
    }),
    response.value,
    principal
  );

  assert.equal(created.meta.version, 1);
  assert.equal(response.headers.get("etag"), "\"v1\"");
  assert.deepEqual(captured?.[0], {
    tenant: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "OWNER",
      membershipId,
      membershipVersion: 3,
      projectAccessLevel: "ALL"
    },
    actorId,
    requestId: "request-rank-automation-001"
  });
  assert.deepEqual(captured?.[1], {
    ...createInput,
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: "rank-automation-create-001",
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
      entitlementStatus: "ALLOWED"
    },
    billingCurrency: "RUB",
    entitlement: {
      planCode: "TRIAL",
      planVersion: 1,
      scheduledAutomations: 1
    }
  });
  assert.deepEqual(
    records.map(({ action, outcome, resourceId }) => ({
      action,
      outcome,
      resourceId
    })),
    [
      {
        action: "ranking.automation.create_requested",
        outcome: "REQUESTED",
        resourceId: undefined
      },
      {
        action: "ranking.automation.created",
        outcome: "SUCCESS",
        resourceId: automationId
      }
    ]
  );
});

test("runs manually with a stable key and keeps requested audit fail-closed", async () => {
  let captured: readonly unknown[] | undefined;
  const records: AuditRecord[] = [];
  const controller = controllerWith({
    jobs: {
      runAutomation: async (...args: unknown[]) => {
        captured = args;
        return run;
      }
    },
    records
  });

  const result = await controller.run(
    automationId.toUpperCase(),
    {},
    request({
      headers: {
        "if-match": "\"v1\"",
        "idempotency-key": "rank-automation-run-001"
      }
    }),
    principal
  );

  assert.equal(result.data.id, runId);
  assert.deepEqual(captured?.[1], {
    workspaceId,
    projectId,
    actorId,
    automationId,
    expectedVersion: 1,
    idempotencyKey: "rank-automation-run-001",
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
      entitlementStatus: "ALLOWED"
    },
    billingCurrency: "RUB"
  });
  assert.equal(
    records[1]?.resourceType,
    "rank_tracking_automation_run"
  );

  let jobsCalled = false;
  const blocked = controllerWith({
    jobs: {
      runAutomation: async () => {
        jobsCalled = true;
        return run;
      }
    },
    audit: {
      record: async () => {
        throw new Error("audit unavailable");
      }
    }
  });
  await assert.rejects(
    blocked.run(
      automationId,
      {},
      request({
        headers: {
          "if-match": "\"v1\"",
          "idempotency-key": "rank-automation-run-002"
        }
      }),
      principal
    ),
    /audit unavailable/u
  );
  assert.equal(jobsCalled, false);
});

test("blocks an enabled schedule before audit when execution is unavailable", async () => {
  let sideEffect = false;
  const controller = controllerWith({
    jobs: {
      createAutomation: async () => {
        sideEffect = true;
        return summary;
      }
    },
    billing: {
      automationCapacity: async () => ({
        planCode: "TRIAL",
        planVersion: 1,
        scheduledAutomations: 1
      }),
      rankProviderAccess: async () => "NOT_AVAILABLE"
    },
    audit: {
      record: async () => {
        sideEffect = true;
      }
    }
  });

  await assert.rejects(
    controller.create(
      createInput,
      request({
        headers: {
          "idempotency-key": "rank-automation-create-002"
        }
      }),
      reply().value,
      principal
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "PAYMENT_REQUIRED"
  );
  assert.equal(sideEffect, false);
});

function controllerWith(
  options: Readonly<{
    jobs?: Partial<JobsClient>;
    billing?: Partial<BillingEntitlementService>;
    audit?: Partial<AuditService>;
    records?: AuditRecord[];
  }> = {}
): AutomationController {
  const records = options.records ?? [];
  return new AutomationController(
    (options.jobs ?? {}) as JobsClient,
    tenantService(),
    {
      automationCapacityForRead: async () => ({
        planCode: "TRIAL",
        planVersion: 1,
        scheduledAutomations: 1
      }),
      automationCapacity: async () => ({
        planCode: "TRIAL",
        planVersion: 1,
        scheduledAutomations: 1
      }),
      rankProviderAccess: async () => "ALLOWED",
      ...options.billing
    } as unknown as BillingEntitlementService,
    {
      record: async (record: AuditRecord) => {
        records.push(record);
      },
      ...options.audit
    } as unknown as AuditService
  );
}

function tenantService(): TenantService {
  return {
    getWorkspace: async () => ({
      id: workspaceId,
      name: "Workspace",
      slug: "workspace",
      locale: "ru",
      timezone: "Europe/Moscow",
      billingCurrency: "RUB",
      status: "ACTIVE",
      roleCode: "OWNER",
      version: 2,
      createdAt: "2026-07-31T08:00:00.000Z"
    }),
    getProject: async () => ({
      id: projectId,
      workspaceId,
      name: "Project",
      slug: "project",
      domain: "example.com",
      locale: "ru",
      timezone: "Europe/Moscow",
      status: "ACTIVE",
      version: 4,
      createdAt: "2026-07-31T08:00:00.000Z"
    })
  } as unknown as TenantService;
}

function request(
  options: Readonly<{
    headers?: Readonly<Record<string, string>>;
    workspaceStatus?: "ACTIVE" | "READ_ONLY";
  }> = {}
): TenantRequest {
  return {
    id: "request-rank-automation-001",
    headers: options.headers ?? {},
    tenantAuthorization: {
      workspaceId,
      workspaceStatus: options.workspaceStatus ?? "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "OWNER",
      membershipId,
      membershipVersion: 3,
      projectAccessLevel: "ALL"
    }
  } as unknown as TenantRequest;
}

function reply(): {
  readonly value: FastifyReply;
  readonly headers: Map<string, string>;
} {
  const headers = new Map<string, string>();
  return {
    value: {
      header: (name: string, value: string) => {
        headers.set(name.toLowerCase(), value);
      }
    } as unknown as FastifyReply,
    headers
  };
}

function assertRoute(
  method: (...args: never[]) => unknown,
  permission: string,
  guards: readonly unknown[],
  status?: number
): void {
  assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, method), permission);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), guards);
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, method), status);
}
