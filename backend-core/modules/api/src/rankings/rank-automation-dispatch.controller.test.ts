import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import type { AuditService } from "../audit/audit.service.js";
import type { AuthorizationService } from "../authorization/authorization.service.js";
import type { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { DomainError } from "../common/domain-error.js";
import type { JobsClient } from "../jobs/jobs.client.js";
import type { TenantService } from "../tenants/tenant.service.js";
import { RankAutomationDispatchController } from "./rank-automation-dispatch.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const automationId = "01900000-0000-7000-8000-000000000004";
const runId = "01900000-0000-7000-8000-000000000005";
const trackingContextId = "01900000-0000-7000-8000-000000000006";
const membershipId = "01900000-0000-7000-8000-000000000007";
const estimateId = "01900000-0000-7000-8000-000000000008";
const jobId = "01900000-0000-7000-8000-000000000009";
const requestId = `rank-automation-${runId}`;
const idempotencyKey = `rank-automation-dispatch-${runId}`;

test("rechecks current access, price and quota before every automation run", async () => {
  const calls: Array<{ readonly operation: string; readonly args: readonly unknown[] }> = [];
  const audits: string[] = [];
  const controller = controllerWith({
    jobs: {
      createRankEstimate: async (...args: unknown[]) => {
        calls.push({ operation: "estimate", args });
        return readyEstimate("500000");
      },
      createRankRun: async (...args: unknown[]) => {
        calls.push({ operation: "run", args });
        return { id: jobId };
      }
    },
    audit: {
      record: async (record: { readonly action: string }) => {
        audits.push(record.action);
      }
    }
  });

  const response = await controller.dispatch(
    workspaceId,
    projectId,
    dispatchInput("500000"),
    dispatchRequest()
  );

  assert.deepEqual(response.data, { estimateId, jobId });
  assert.deepEqual(calls.map(({ operation }) => operation), ["estimate", "run"]);
  assert.equal(calls[0]?.args[2], `automation-estimate-${runId}`);
  assert.equal(calls[1]?.args[2], `automation-rank-${runId}`);
  assert.deepEqual(calls[1]?.args[1], {
    estimateId,
    confirmedPlatformChargeMicro: "500000",
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
      entitlementStatus: "ALLOWED",
      quota: { status: "UNLIMITED" }
    },
    billingCurrency: "RUB",
    jobCapacity: {
      planCode: "PRO",
      planVersion: 2,
      concurrentJobs: 4
    }
  });
  assert.deepEqual(audits, [
    "ranking.automation.dispatch_requested",
    "ranking.automation.dispatched"
  ]);
});

test("does not create a paid Job when the fresh estimate exceeds the cap", async () => {
  let runCalls = 0;
  const controller = controllerWith({
    jobs: {
      createRankEstimate: async () => readyEstimate("500001"),
      createRankRun: async () => {
        runCalls += 1;
        return { id: jobId };
      }
    }
  });

  await assert.rejects(
    controller.dispatch(
      workspaceId,
      projectId,
      dispatchInput("500000"),
      dispatchRequest()
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "RESOURCE_STATE_CONFLICT" &&
      error.details?.limitMicro === "500000"
  );
  assert.equal(runCalls, 0);
});

function controllerWith(options: Readonly<{
  jobs: {
    readonly createRankEstimate: (...args: unknown[]) => Promise<unknown>;
    readonly createRankRun: (...args: unknown[]) => Promise<unknown>;
  };
  audit?: {
    readonly record: (
      record: { readonly action: string }
    ) => Promise<void>;
  };
}>): RankAutomationDispatchController {
  return new RankAutomationDispatchController(
    {
      forProject: async () => ({
        workspaceId,
        projectId,
        workspaceStatus: "ACTIVE",
        projectStatus: "ACTIVE",
        roleCode: "OWNER",
        membershipId,
        membershipVersion: 3,
        projectAccessLevel: "MANAGER"
      })
    } as unknown as AuthorizationService,
    {
      rankProviderRunAccess: async () => ({
        entitlementStatus: "ALLOWED",
        quota: { status: "UNLIMITED" }
      }),
      jobCapacity: async () => ({
        planCode: "PRO",
        planVersion: 2,
        concurrentJobs: 4
      })
    } as unknown as BillingEntitlementService,
    {
      getWorkspace: async () => ({
        id: workspaceId,
        status: "ACTIVE",
        billingCurrency: "RUB"
      }),
      getProject: async () => ({
        id: projectId,
        workspaceId,
        domain: "example.com",
        status: "ACTIVE",
        version: 4
      })
    } as unknown as TenantService,
    options.jobs as unknown as JobsClient,
    (options.audit ?? { record: async () => undefined }) as unknown as AuditService
  );
}

function readyEstimate(platformChargeMicro: string) {
  return {
    id: estimateId,
    status: "READY",
    executionAllowed: true,
    blockers: [],
    scope: { keywordCount: "3" },
    platformChargeMicro
  };
}

function dispatchInput(maxPlatformChargeMicro: string) {
  return {
    workspaceId,
    projectId,
    actorId,
    automationId,
    automationVersion: 2,
    runId,
    idempotencyKey,
    scheduledFor: "2026-09-05T08:30:00.000Z",
    trackingContextId,
    maxPlatformChargeMicro
  };
}

function dispatchRequest(): FastifyRequest {
  return {
    id: requestId,
    headers: {
      "x-request-id": requestId,
      "x-workspace-id": workspaceId,
      "x-project-id": projectId,
      "x-actor-id": actorId,
      "idempotency-key": idempotencyKey
    }
  } as unknown as FastifyRequest;
}
