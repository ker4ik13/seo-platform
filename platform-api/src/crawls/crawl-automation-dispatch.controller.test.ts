import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import type { AuditService } from "../audit/audit.service.js";
import type { AuthorizationService } from "../authorization/authorization.service.js";
import type { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import type { JobsClient } from "../jobs/jobs.client.js";
import { CrawlAutomationDispatchController } from "./crawl-automation-dispatch.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const automationId = "01900000-0000-7000-8000-000000000004";
const runId = "01900000-0000-7000-8000-000000000005";
const requestId = `crawl-automation-${runId}`;
const idempotencyKey = `crawl-automation-${runId}`;

test("checks current billing before a scheduled crawl is dispatched", async () => {
  const billingError = new Error("subscription is no longer usable");
  let jobsCalls = 0;
  let auditCalls = 0;
  const controller = new CrawlAutomationDispatchController(
    {
      forProject: async () => ({
        workspaceId,
        projectId,
        workspaceStatus: "ACTIVE",
        projectStatus: "ACTIVE",
        roleCode: "OWNER"
      })
    } as unknown as AuthorizationService,
    {
      automationCapacity: async () => {
        throw billingError;
      }
    } as unknown as BillingEntitlementService,
    {
      createTechnicalCrawl: async () => {
        jobsCalls += 1;
        throw new Error("must not dispatch");
      }
    } as unknown as JobsClient,
    {
      record: async () => {
        auditCalls += 1;
      }
    } as unknown as AuditService
  );

  await assert.rejects(
    controller.dispatch(
      workspaceId,
      projectId,
      dispatchInput(),
      dispatchRequest()
    ),
    (error: unknown) => error === billingError
  );
  assert.equal(jobsCalls, 0);
  assert.equal(auditCalls, 0);
});

function dispatchInput() {
  return {
    workspaceId,
    projectId,
    actorId,
    automationId,
    automationVersion: 1,
    runId,
    idempotencyKey,
    scheduledFor: "2026-07-31T12:00:00.000Z",
    config: {
      startUrls: ["https://example.com/"],
      sitemapUrls: [],
      includePatterns: [],
      excludePatterns: [],
      queryPolicy: "DROP_TRACKING",
      maxUrls: 100,
      maxDepth: 3,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 30,
      obeyRobots: true
    }
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
