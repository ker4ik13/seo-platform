import assert from "node:assert/strict";
import test from "node:test";
import type { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import type { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import type { JobsClient } from "../jobs/jobs.client.js";
import { CrawlAutomationController } from "./crawl-automation.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const automationId = "01900000-0000-7000-8000-000000000004";

test("checks current billing before a manual crawl automation run", async () => {
  const billingError = new Error("subscription is no longer usable");
  let jobsCalls = 0;
  let auditCalls = 0;
  const controller = new CrawlAutomationController(
    {
      runCrawlAutomation: async () => {
        jobsCalls += 1;
        throw new Error("must not dispatch");
      }
    } as unknown as JobsClient,
    {
      automationCapacity: async () => {
        throw billingError;
      }
    } as unknown as BillingEntitlementService,
    {
      record: async () => {
        auditCalls += 1;
      }
    } as unknown as AuditService
  );

  await assert.rejects(
    controller.run(automationId, {}, request(), principal()),
    (error: unknown) => error === billingError
  );
  assert.equal(jobsCalls, 0);
  assert.equal(auditCalls, 0);
});

function request(): TenantRequest {
  return {
    id: "request-crawl-automation-run-001",
    headers: {
      "if-match": '"1"',
      "idempotency-key": "crawl-automation-run-0001"
    },
    tenantAuthorization: {
      workspaceId,
      projectId,
      workspaceStatus: "ACTIVE",
      projectStatus: "ACTIVE",
      roleCode: "OWNER"
    }
  } as unknown as TenantRequest;
}

function principal(): AuthenticatedPrincipal {
  return {
    userId: actorId,
    sessionId: "01900000-0000-7000-8000-000000000005",
    sessionFamilyId: "01900000-0000-7000-8000-000000000006",
    authenticatedAt: new Date("2026-07-31T10:00:00.000Z"),
    expiresAt: new Date("2026-08-31T10:00:00.000Z")
  };
}
