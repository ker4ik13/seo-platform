import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA
} from "@nestjs/common/constants.js";
import type { RankEstimate } from "@seo-platform/contracts";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { DomainError } from "../common/domain-error.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { TenantService } from "../tenants/tenant.service.js";
import { RankEstimateController } from "./rank-estimate.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const contextId = "01900000-0000-7000-8000-000000000004";
const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000005",
  sessionFamilyId: "01900000-0000-7000-8000-000000000006",
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 900_000)
};
const estimate: RankEstimate = {
  id: "01900000-0000-7000-8000-000000000007",
  workspaceId,
  projectId,
  trackingContextId: contextId,
  status: "BLOCKED",
  provider: "ARSENKIN",
  operation: "POSITIONS",
  credentialMode: "BYOK_API_KEY",
  scope: {
    keywordCount: "1",
    contextCount: "1",
    pairCount: "1",
    scopeHash: {
      availability: "AVAILABLE",
      algorithm: "SHA_256",
      value: "a".repeat(64)
    },
    contextVersion: 1,
    configurationVersion: 1
  },
  workload: {
    taskCount: "1",
    minimumRequestCount: "3",
    pollingRequestCount: { status: "NOT_AVAILABLE" },
    requestStages: ["SET", "CHECK", "GET"],
    keywordLimitPerTask: "250",
    keywordLimitPerCommand: "1000",
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE"
  },
  providerLimits: { status: "NOT_AVAILABLE" },
  expectedDuration: { status: "NOT_AVAILABLE" },
  platformChargeMicro: "0",
  billingCurrency: "RUB",
  quota: { status: "NOT_AVAILABLE" },
  credentialFreshness: { status: "NOT_AVAILABLE" },
  retention: {
    normalizedRankHistory: "LONG_TERM",
    rawSerp: "NOT_COLLECTED"
  },
  blockers: [
    { code: "PROVIDER_CONTRACT_NOT_READY" },
    { code: "PROVIDER_EXECUTION_DISABLED" }
  ],
  executionAllowed: false,
  policyVersion: "arsenkin-positions@1",
  calculatedAt: "2026-07-29T12:00:00.000Z",
  expiresAt: "2026-07-29T12:05:00.000Z"
};

test("guards estimate as a CSRF-protected ranking view command", () => {
  const method = RankEstimateController.prototype.create;
  assert.equal(
    Reflect.getMetadata(REQUIRED_PERMISSION, method),
    "ranking.view"
  );
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
    CsrfSessionGuard,
    TenantPermissionGuard
  ]);
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, method), 201);
});

test("builds a trusted project/access snapshot without browser authority", async () => {
  let captured: readonly unknown[] | undefined;
  const controller = new RankEstimateController(
    {
      createRankEstimate: async (...args: unknown[]) => {
        captured = args;
        return estimate;
      }
    } as unknown as JobsClient,
    tenantService({
      workspaceStatus: "READ_ONLY",
      projectStatus: "ARCHIVED"
    }),
    billingEntitlements()
  );

  const response = await controller.create(
    { trackingContextId: contextId.toUpperCase() },
    request({
      headers: { "idempotency-key": "rank-estimate-001" },
      workspaceStatus: "READ_ONLY",
      projectStatus: "ARCHIVED"
    }),
    principal
  );

  assert.equal(response.data.id, estimate.id);
  assert.equal(captured?.[2], "rank-estimate-001");
  assert.deepEqual(captured?.[0], {
    tenant: {
      workspaceId,
      workspaceStatus: "READ_ONLY",
      projectId,
      projectStatus: "ARCHIVED",
      roleCode: "OWNER"
    },
    actorId,
    requestId: "request-rank-estimate-001"
  });
  assert.deepEqual(captured?.[1], {
    trackingContextId: contextId,
    workspaceId,
    projectId,
    actorId,
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ARCHIVED",
      version: 4
    },
    access: {
      workspaceStatus: "READ_ONLY",
      canRunRanking: true,
      entitlementStatus: "ALLOWED"
    },
    billingCurrency: "RUB",
    quota: { status: "UNLIMITED" }
  });
});

test("projects missing run permission while keeping estimate access", async () => {
  let canRunRanking: boolean | undefined;
  const controller = new RankEstimateController(
    {
      createRankEstimate: async (
        _context: unknown,
        input: {
          readonly access: { readonly canRunRanking: boolean };
        }
      ) => {
        canRunRanking = input.access.canRunRanking;
        return estimate;
      }
    } as unknown as JobsClient,
    tenantService({ workspaceRoleCode: "ANALYST" }),
    billingEntitlements()
  );

  await controller.create(
    { trackingContextId: contextId },
    request({
      headers: { "idempotency-key": "rank-estimate-002" },
      roleCode: "ANALYST"
    }),
    principal
  );

  assert.equal(canRunRanking, false);
});

test("rejects missing idempotency before loading tenant snapshots", async () => {
  let tenantRead = false;
  const controller = new RankEstimateController(
    {} as JobsClient,
    {
      getWorkspace: async () => {
        tenantRead = true;
      },
      getProject: async () => {
        tenantRead = true;
      }
    } as unknown as TenantService,
    billingEntitlements()
  );

  await assert.rejects(
    () =>
      controller.create(
        { trackingContextId: contextId },
        request(),
        principal
      ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "VALIDATION_FAILED"
  );
  assert.equal(tenantRead, false);
});

test("fails closed when authoritative project ownership changes", async () => {
  const controller = new RankEstimateController(
    {} as JobsClient,
    tenantService({
      projectWorkspaceId:
        "01900000-0000-7000-8000-000000000099"
    }),
    billingEntitlements()
  );

  await assert.rejects(
    () =>
      controller.create(
        { trackingContextId: contextId },
        request({
          headers: { "idempotency-key": "rank-estimate-003" }
        }),
        principal
      ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "RESOURCE_STATE_CONFLICT"
  );
});

function tenantService(
  options: Readonly<{
    workspaceStatus?: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
    workspaceRoleCode?: string;
    projectStatus?: "DRAFT" | "ACTIVE" | "ARCHIVED";
    projectWorkspaceId?: string;
  }>
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
      roleCode: options.workspaceRoleCode ?? "OWNER",
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

function billingEntitlements(
  status: "ALLOWED" | "DENIED" | "NOT_AVAILABLE" = "ALLOWED"
): BillingEntitlementService {
  return {
    rankProviderRunAccess: async () => ({
      entitlementStatus: status,
      quota: status === "ALLOWED"
        ? { status: "UNLIMITED" }
        : { status: "NOT_AVAILABLE" }
    })
  } as unknown as BillingEntitlementService;
}

function request(
  options: Readonly<{
    headers?: Readonly<Record<string, string>>;
    workspaceStatus?: "ACTIVE" | "READ_ONLY";
    projectStatus?: "DRAFT" | "ACTIVE" | "ARCHIVED";
    roleCode?: string;
  }> = {}
): TenantRequest {
  return {
    id: "request-rank-estimate-001",
    headers: options.headers ?? {},
    tenantAuthorization: {
      workspaceId,
      workspaceStatus: options.workspaceStatus ?? "ACTIVE",
      projectId,
      projectStatus: options.projectStatus ?? "ACTIVE",
      roleCode: options.roleCode ?? "OWNER"
    }
  } as TenantRequest;
}
