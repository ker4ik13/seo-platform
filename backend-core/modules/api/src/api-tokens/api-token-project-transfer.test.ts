import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../generated/prisma/client.js";
import type { AuditService } from "../audit/audit.service.js";
import type { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { JobsClient } from "../jobs/jobs.client.js";
import type { OutboxService } from "../outbox/outbox.service.js";
import type { SeoDataClient } from "../seo-data/seo-data.client.js";
import { ProjectTransferService } from "../tenants/project-transfer.service.js";

const sourceWorkspaceId = "01900000-0000-7000-8000-000000000001";
const destinationWorkspaceId = "01900000-0000-7000-8000-000000000002";
const projectId = "01900000-0000-7000-8000-000000000003";
const transferId = "01900000-0000-7000-8000-000000000004";
const fromUserId = "01900000-0000-7000-8000-000000000005";
const toUserId = "01900000-0000-7000-8000-000000000006";

test("revokes source-workspace API grants before moving a project", async () => {
  const order: string[] = [];
  const current = {
    id: transferId,
    status: "PROCESSING",
    workspaceId: sourceWorkspaceId,
    destinationWorkspaceId,
    sourceProjectStatus: "ACTIVE",
    projectId,
    fromUserId,
    toUserId,
    project: {
      id: projectId,
      slug: "project",
      archivedAt: null
    },
    destinationWorkspace: { status: "ACTIVE" }
  };
  let rawQueryCalls = 0;
  const transaction = {
    $queryRaw: async () => {
      rawQueryCalls += 1;
      return rawQueryCalls === 1
        ? [
            { id: sourceWorkspaceId, status: "ACTIVE" },
            { id: destinationWorkspaceId, status: "ACTIVE" }
          ].sort((left, right) => left.id.localeCompare(right.id))
        : [{ now: new Date("2026-09-01T12:00:00.000Z") }];
    },
    projectTransferRequest: {
      findUnique: async () => current,
      updateMany: async () => ({ count: 1 })
    },
    workspaceMember: {
      findUnique: async () => ({
        id: "01900000-0000-7000-8000-000000000007",
        status: "ACTIVE",
        roleCode: "OWNER"
      })
    },
    project: {
      findFirst: async () => null,
      aggregate: async () => ({ _max: { displayOrder: 7 } }),
      updateMany: async () => {
        order.push("move-project");
        return { count: 1 };
      }
    },
    projectMemberAccess: {
      deleteMany: async () => ({ count: 1 }),
      create: async () => ({})
    },
    apiTokenProjectAccess: {
      deleteMany: async (input: unknown) => {
        order.push("revoke-api-grants");
        assert.deepEqual(input, {
          where: { projectId, workspaceId: sourceWorkspaceId }
        });
        return { count: 2 };
      }
    }
  } as unknown as Prisma.TransactionClient;
  const service = new ProjectTransferService(
    {
      $transaction: async (
        callback: (client: Prisma.TransactionClient) => Promise<unknown>
      ) => callback(transaction)
    } as unknown as PrismaService,
    { record: async () => undefined } as unknown as AuditService,
    { event: async () => undefined } as unknown as OutboxService,
    {} as BillingEntitlementService,
    {} as JobsClient,
    {} as SeoDataClient
  );

  await (
    service as unknown as {
      finalizeTransfer: (id: string, requestId: string) => Promise<void>;
    }
  ).finalizeTransfer(transferId, "project-transfer-test");

  assert.deepEqual(order, ["revoke-api-grants", "move-project"]);
});
