import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type {
  AuditRecord,
  AuditService
} from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { DomainError } from "../common/domain-error.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { TenantService } from "../tenants/tenant.service.js";
import { RankRunController } from "./rank-run.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const membershipId = "01900000-0000-7000-8000-000000000004";
const estimateId = "01900000-0000-7000-8000-000000000005";
const contextId = "01900000-0000-7000-8000-000000000006";
const jobId = "01900000-0000-7000-8000-000000000007";

const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000008",
  sessionFamilyId: "01900000-0000-7000-8000-000000000009",
  authenticatedAt: new Date("2026-07-29T11:00:00.000Z"),
  expiresAt: new Date("2026-07-29T13:00:00.000Z")
};

test("exposes the exact public routes, permissions, guards and codes", () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, RankRunController),
    "api/v1/projects/:projectId"
  );
  assertRoute(
    RankRunController.prototype.create,
    "rank-runs",
    "ranking.run",
    [CsrfSessionGuard, TenantPermissionGuard],
    202
  );
  assertRoute(
    RankRunController.prototype.get,
    "jobs/:jobId",
    "ranking.view",
    [SessionAuthGuard, TenantPermissionGuard]
  );
  assertRoute(
    RankRunController.prototype.cancel,
    "jobs/:jobId/cancel",
    "collector.cancel",
    [CsrfSessionGuard, TenantPermissionGuard],
    200
  );
});

test("creates a trusted rank command and returns project-scoped Location", async () => {
  let captured: readonly unknown[] | undefined;
  const auditRecords: AuditRecord[] = [];
  let location: string | undefined;
  const controller = new RankRunController(
    {
      createRankRun: async (...args: unknown[]) => {
        captured = args;
        return preparingJob();
      }
    } as unknown as JobsClient,
    tenantService(),
    auditService(auditRecords)
  );

  const response = await controller.create(
    { estimateId: estimateId.toUpperCase() },
    request({
      headers: { "idempotency-key": "rank-run-create-0001" }
    }),
    {
      header: (name: string, value: string) => {
        if (name === "Location") location = value;
      }
    } as never,
    principal
  );

  assert.equal(response.data.id, jobId);
  assert.equal(
    location,
    `/api/v1/projects/${projectId}/jobs/${jobId}`
  );
  assert.equal(captured?.[2], "rank-run-create-0001");
  assert.deepEqual(captured?.[0], {
    tenant: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "SEO_SPECIALIST",
      membershipId,
      membershipVersion: 3,
      projectAccessLevel: "MEMBER"
    },
    actorId,
    requestId: "request-rank-run-001"
  });
  assert.deepEqual(captured?.[1], {
    estimateId,
    workspaceId,
    projectId,
    actorId,
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
      entitlementStatus: "NOT_AVAILABLE",
      quota: { status: "NOT_AVAILABLE" }
    },
    billingCurrency: "RUB"
  });
  assert.deepEqual(
    auditRecords.map(({ action, resourceId }) => ({
      action,
      resourceId
    })),
    [
      {
        action: "ranking.rank_run.create_requested",
        resourceId: undefined
      },
      {
        action: "ranking.rank_run.created",
        resourceId: jobId
      }
    ]
  );
  assert.equal(JSON.stringify(auditRecords).includes(estimateId), false);
  assert.equal(JSON.stringify(auditRecords).includes("example.com"), false);
});

test("reads and cancels teammate Jobs in archived read-only projects", async () => {
  const calls: Array<{
    readonly operation: string;
    readonly context: unknown;
    readonly jobId: string;
  }> = [];
  const auditRecords: AuditRecord[] = [];
  const jobs = {
    getRankJob: async (context: unknown, requestedJobId: string) => {
      calls.push({
        operation: "get",
        context,
        jobId: requestedJobId
      });
      return preparingJob();
    },
    cancelRankJob: async (context: unknown, requestedJobId: string) => {
      calls.push({
        operation: "cancel",
        context,
        jobId: requestedJobId
      });
      return {
        ...preparingJob(),
        status: "CANCEL_REQUESTED" as const,
        stage: "PREPARING_SCOPE" as const
      };
    }
  };
  const controller = new RankRunController(
    jobs as unknown as JobsClient,
    {} as TenantService,
    auditService(auditRecords)
  );
  const readOnlyRequest = request({
    workspaceStatus: "READ_ONLY",
    projectStatus: "ARCHIVED"
  });

  const read = await controller.get(
    jobId.toUpperCase(),
    readOnlyRequest,
    principal
  );
  const cancelled = await controller.cancel(
    jobId.toUpperCase(),
    {},
    readOnlyRequest,
    principal
  );

  assert.equal(read.data.id, jobId);
  assert.equal(cancelled.data.status, "CANCEL_REQUESTED");
  assert.deepEqual(
    calls.map(({ operation, jobId: requestedJobId }) => ({
      operation,
      requestedJobId
    })),
    [
      { operation: "get", requestedJobId: jobId },
      { operation: "cancel", requestedJobId: jobId }
    ]
  );
  for (const { context } of calls) {
    assert.deepEqual(context, {
      tenant: {
        workspaceId,
        workspaceStatus: "READ_ONLY",
        projectId,
        projectStatus: "ARCHIVED",
        roleCode: "SEO_SPECIALIST",
        membershipId,
        membershipVersion: 3,
        projectAccessLevel: "MEMBER"
      },
      actorId,
      requestId: "request-rank-run-001"
    });
  }
  assert.deepEqual(
    auditRecords.map(({ action }) => action),
    [
      "ranking.rank_job.cancel_requested",
      "ranking.rank_job.cancel_resolved"
    ]
  );
});

test("rejects stale lifecycle and access snapshots before audit or RPC", async () => {
  for (const options of [
    { projectStatus: "DRAFT" as const },
    { projectStatus: "ARCHIVED" as const },
    { workspaceStatus: "READ_ONLY" as const },
    { workspaceStatus: "SUSPENDED" as const },
    { workspaceRoleCode: "ANALYST" },
    {
      projectWorkspaceId:
        "01900000-0000-7000-8000-000000000099"
    }
  ]) {
    let jobsCalled = false;
    const auditRecords: AuditRecord[] = [];
    const controller = new RankRunController(
      {
        createRankRun: async () => {
          jobsCalled = true;
          return preparingJob();
        }
      } as unknown as JobsClient,
      tenantService(options),
      auditService(auditRecords)
    );

    await assert.rejects(
      () =>
        controller.create(
          { estimateId },
          request({
            headers: {
              "idempotency-key": "rank-run-create-0002"
            }
          }),
          { header: () => undefined } as never,
          principal
        ),
      (error: unknown) =>
        error instanceof DomainError &&
        [402, 403, 409].includes(error.statusCode)
    );
    assert.equal(jobsCalled, false);
    assert.deepEqual(auditRecords, []);
  }
});

test("rejects a non-empty cancel body before audit or RPC", async () => {
  let jobsCalled = false;
  const auditRecords: AuditRecord[] = [];
  const controller = new RankRunController(
    {
      cancelRankJob: async () => {
        jobsCalled = true;
        return preparingJob();
      }
    } as unknown as JobsClient,
    {} as TenantService,
    auditService(auditRecords)
  );

  await assert.rejects(
    () =>
      controller.cancel(
        jobId,
        { reason: "stop" },
        request(),
        principal
      ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "VALIDATION_FAILED"
  );
  assert.equal(jobsCalled, false);
  assert.deepEqual(auditRecords, []);
});

function assertRoute(
  method: (...args: never[]) => unknown,
  path: string,
  permission: string,
  guards: readonly unknown[],
  status?: number
): void {
  assert.equal(Reflect.getMetadata(PATH_METADATA, method), path);
  assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, method), permission);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), guards);
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, method), status);
}

function tenantService(
  options: Readonly<{
    workspaceStatus?: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
    workspaceRoleCode?: string;
    projectStatus?: "DRAFT" | "ACTIVE" | "ARCHIVED";
    projectWorkspaceId?: string;
  }> = {}
): TenantService {
  return {
    getWorkspace: async () => ({
      id: workspaceId,
      name: "Workspace",
      slug: "workspace",
      locale: "ru",
      timezone: "Europe/Moscow",
      billingCurrency: "RUB",
      status: options.workspaceStatus ?? "ACTIVE",
      roleCode: options.workspaceRoleCode ?? "SEO_SPECIALIST",
      version: 2,
      createdAt: "2026-07-29T10:00:00.000Z"
    }),
    getProject: async () => ({
      id: projectId,
      workspaceId: options.projectWorkspaceId ?? workspaceId,
      name: "Project",
      slug: "project",
      domain: "example.com",
      locale: "ru",
      timezone: "Europe/Moscow",
      status: options.projectStatus ?? "ACTIVE",
      version: 4,
      createdAt: "2026-07-29T10:00:00.000Z"
    })
  } as unknown as TenantService;
}

function auditService(records: AuditRecord[]): AuditService {
  return {
    record: async (record: AuditRecord) => {
      records.push(record);
    }
  } as unknown as AuditService;
}

function request(
  options: Readonly<{
    headers?: Readonly<Record<string, string>>;
    workspaceStatus?: "ACTIVE" | "READ_ONLY";
    projectStatus?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  }> = {}
): TenantRequest {
  return {
    id: "request-rank-run-001",
    headers: options.headers ?? {},
    tenantAuthorization: {
      workspaceId,
      workspaceStatus: options.workspaceStatus ?? "ACTIVE",
      projectId,
      projectStatus: options.projectStatus ?? "ACTIVE",
      roleCode: "SEO_SPECIALIST",
      membershipId,
      membershipVersion: 3,
      projectAccessLevel: "MEMBER"
    }
  } as TenantRequest;
}

function preparingJob() {
  return {
    id: jobId,
    workspaceId,
    projectId,
    trackingContextId: contextId,
    type: "MANUAL_RANK_CHECK" as const,
    provider: "ARSENKIN" as const,
    operation: "POSITIONS" as const,
    credentialMode: "BYOK_API_KEY" as const,
    status: "PREPARING" as const,
    stage: "PREPARING_SCOPE" as const,
    progress: {
      current: "0",
      total: "2",
      unit: "KEYWORD" as const
    },
    platformChargeMicro: "0" as const,
    billingCurrency: "RUB",
    createdAt: "2026-07-29T12:00:00.000Z"
  };
}
