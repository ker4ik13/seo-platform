import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import { ProjectTransferResetService } from "./project-transfer-reset.service.js";

const WORKSPACE_ID = "01900000-0000-7000-8000-000000000001";
const PROJECT_ID = "01900000-0000-7000-8000-000000000002";

test("blocks transfer while any project operation is active", async () => {
  let bindingsChanged = false;
  const transaction = resetTransaction({
    activeJobs: 1,
    onBindingUpdate: () => {
      bindingsChanged = true;
    }
  });
  const service = serviceWith(transaction);

  await assert.rejects(
    service.reset(WORKSPACE_ID, PROJECT_ID),
    (error: unknown) => error instanceof ConflictException
  );
  assert.equal(bindingsChanged, false);
});

test("cancels dormant import drafts instead of blocking project transfer", async () => {
  const updates: Array<readonly [string, unknown]> = [];
  const importCountQueries: unknown[] = [];
  const transaction = resetTransaction({
    onImportCount: (input) => importCountQueries.push(input),
    onUpdate: (model, input) => updates.push([model, input])
  });
  const service = serviceWith(transaction);

  assert.deepEqual(await service.reset(WORKSPACE_ID, PROJECT_ID), {
    status: "RESET"
  });
  assert.equal(importCountQueries.length, 2);
  assert.deepEqual(importCountQueries[0], {
    where: {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      status: {
        in: [
          "QUEUED",
          "PARSING",
          "VALIDATING",
          "READY_TO_PUBLISH",
          "PUBLISHING",
          "CANCEL_REQUESTED"
        ]
      }
    }
  });
  const importUpdate = updates.find(([model]) => model === "semanticImport")?.[1];
  assert.deepEqual(importUpdate, {
    where: {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      status: { in: ["AWAITING_MAPPING", "AWAITING_CONFIRMATION"] }
    },
    data: {
      status: "CANCELLED",
      stage: "cancelled",
      cancelRequestedAt: (importUpdate as { data: { cancelRequestedAt: Date } }).data.cancelRequestedAt,
      version: { increment: 1 }
    }
  });
  assert.ok(
    (importUpdate as { data: { cancelRequestedAt: unknown } }).data.cancelRequestedAt instanceof Date
  );
});

test("disables automations and detaches every project provider route", async () => {
  const updates: Array<readonly [string, unknown]> = [];
  const transaction = resetTransaction({
    onUpdate: (model, input) => updates.push([model, input])
  });
  const service = serviceWith(transaction);

  assert.deepEqual(await service.reset(WORKSPACE_ID, PROJECT_ID), {
    status: "RESET"
  });
  assert.equal(updates.length, 5);
  const binding = updates.find(([model]) => model === "binding")?.[1] as {
    readonly data?: Readonly<Record<string, unknown>>;
  };
  assert.deepEqual(binding.data, {
    enabled: false,
    fallbackMode: "NONE",
    fallbackReasons: [],
    configurationScope: "PROJECT_OVERRIDE",
    workspaceBindingId: null,
    workspaceBindingVersion: null,
    version: { increment: 1 }
  });
  const route = updates.find(([model]) => model === "route")?.[1] as {
    readonly data?: Readonly<Record<string, unknown>>;
  };
  assert.ok(route.data?.retiredAt instanceof Date);
});

function serviceWith(transaction: Prisma.TransactionClient) {
  return new ProjectTransferResetService({
    $transaction: async (
      callback: (client: Prisma.TransactionClient) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService);
}

function resetTransaction(
  options: Readonly<{
    activeJobs?: number;
    onBindingUpdate?: () => void;
    onImportCount?: (input: unknown) => void;
    onUpdate?: (model: string, input: unknown) => void;
  }> = {}
): Prisma.TransactionClient {
  const update = (model: string) => async (input: unknown) => {
    options.onUpdate?.(model, input);
    if (model === "binding") options.onBindingUpdate?.();
    return { count: 1 };
  };
  return {
    job: { count: async () => options.activeJobs ?? 0 },
    semanticImport: {
      count: async (input: unknown) => {
        options.onImportCount?.(input);
        return 0;
      },
      updateMany: update("semanticImport")
    },
    automationRun: { count: async () => 0 },
    crawlAutomationRun: { count: async () => 0 },
    automation: { updateMany: update("automation") },
    crawlAutomation: { updateMany: update("crawlAutomation") },
    projectConnectorRoute: { updateMany: update("route") },
    projectConnectorBinding: { updateMany: update("binding") }
  } as unknown as Prisma.TransactionClient;
}
