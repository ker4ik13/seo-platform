import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { WorkspaceConnectorRoutingService } from "./workspace-connector-routing.service.js";

const workspaceId = "0190abcd-1000-7000-8000-000000000001";
const projectId = "0190abcd-1000-7000-8000-000000000002";
const actorId = "0190abcd-1000-7000-8000-000000000003";
const bindingId = "0190abcd-1000-7000-8000-000000000004";
const workspaceBindingId = "0190abcd-1000-7000-8000-000000000005";
const now = new Date("2026-08-04T10:00:00.000Z");

test("uses the next project route for an explicitly allowed low-balance fallback", async () => {
  const binding = projectBinding({
    fallbackMode: "NEXT_AVAILABLE",
    fallbackReasons: ["LOW_BALANCE"],
    routes: [
      projectRoute(0, "XMLSTOCK", "LOW_BALANCE"),
      projectRoute(1, "ARSENKIN", "ACTIVE")
    ]
  });
  const result = await service(binding).resolve(
    workspaceId,
    projectId,
    "SERP_RANK_TRACKING",
    actorId
  );

  assert.equal(result.provider, "ARSENKIN");
  assert.equal(result.routingScope, "PROJECT_OVERRIDE");
  assert.deepEqual(
    result.attempts.map(({ provider, routingScope, outcome, reasonCode }) => ({
      provider,
      routingScope,
      outcome,
      reasonCode
    })),
    [
      {
        provider: "XMLSTOCK",
        routingScope: "PROJECT_OVERRIDE",
        outcome: "FALLBACK",
        reasonCode: "LOW_BALANCE"
      },
      {
        provider: "ARSENKIN",
        routingScope: "PROJECT_OVERRIDE",
        outcome: "SELECTED",
        reasonCode: undefined
      }
    ]
  );
});

test("starts an explicit launch from the selected credential without mutating the binding", async () => {
  const first = projectRoute(0, "XMLSTOCK", "ACTIVE");
  const second = projectRoute(1, "ARSENKIN", "ACTIVE");
  const selectedCredentialId = (second as { credentialId: string }).credentialId;
  const binding = projectBinding({
    fallbackMode: "NEXT_AVAILABLE",
    fallbackReasons: ["RETRYABLE_PROVIDER_ERROR"],
    routes: [first, second]
  });

  const result = await service(binding).resolve(
    workspaceId,
    projectId,
    "SERP_RANK_TRACKING",
    actorId,
    "ARSENKIN",
    selectedCredentialId
  );

  assert.equal(result.provider, "ARSENKIN");
  assert.equal(result.credentialId, selectedCredentialId);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.outcome, "SELECTED");
});

test("reports a workspace-inherited route as the workspace default", async () => {
  const workspace = workspaceBinding();
  const binding = projectBinding({
    configurationScope: "WORKSPACE_INHERITED",
    workspaceBindingId,
    workspaceBindingVersion: 7,
    fallbackMode: "NONE",
    fallbackReasons: [],
    routes: [projectRoute(0, "XMLSTOCK", "ACTIVE", "WORKSPACE_DEFAULT")]
  });
  const result = await service(binding, workspace).resolve(
    workspaceId,
    projectId,
    "SERP_RANK_TRACKING",
    actorId
  );

  assert.equal(result.provider, "XMLSTOCK");
  assert.equal(result.routingScope, "WORKSPACE_DEFAULT");
  assert.equal(result.attempts[0]?.outcome, "SELECTED");
});

test("uses the next route for a known retryable provider degradation", async () => {
  const binding = projectBinding({
    fallbackMode: "NEXT_AVAILABLE",
    fallbackReasons: ["RETRYABLE_PROVIDER_ERROR"],
    routes: [
      projectRoute(0, "XMLSTOCK", "DEGRADED"),
      projectRoute(1, "ARSENKIN", "ACTIVE")
    ]
  });

  const result = await service(binding).resolve(
    workspaceId,
    projectId,
    "SERP_RANK_TRACKING",
    actorId
  );

  assert.equal(result.provider, "ARSENKIN");
  assert.deepEqual(result.attempts.map(({ outcome, reasonCode }) => ({ outcome, reasonCode })), [
    { outcome: "FALLBACK", reasonCode: "RETRYABLE_PROVIDER_ERROR" },
    { outcome: "SELECTED", reasonCode: undefined }
  ]);
});

test("does not fall through when the failure reason is not allowed", async () => {
  const binding = projectBinding({
    fallbackMode: "NEXT_AVAILABLE",
    fallbackReasons: ["RATE_LIMITED"],
    routes: [
      projectRoute(0, "XMLSTOCK", "LOW_BALANCE"),
      projectRoute(1, "ARSENKIN", "ACTIVE")
    ]
  });

  await assert.rejects(
    service(binding).resolve(
      workspaceId,
      projectId,
      "SERP_RANK_TRACKING",
      actorId
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.deepEqual(error.getResponse(), {
        code: "CONNECTOR_NOT_READY",
        message: "No active integration route can execute this operation"
      });
      return true;
    }
  );
});

function service(project: unknown, workspace: unknown = null): WorkspaceConnectorRoutingService {
  const transaction = {
    projectConnectorBinding: {
      findUnique: async () => project
    },
    workspaceConnectorBinding: {
      findUnique: async () => workspace
    }
  };
  const prisma = {
    $transaction: async (
      callback: (value: typeof transaction) => Promise<unknown>
    ) => callback(transaction),
    projectConnectorBinding: {
      findUnique: async () => project
    }
  } as unknown as PrismaService;
  return new WorkspaceConnectorRoutingService(prisma);
}

function projectBinding(overrides: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    id: bindingId,
    workspaceId,
    projectId,
    capability: "SERP_RANK_TRACKING",
    enabled: true,
    fallbackMode: "NONE",
    fallbackReasons: [],
    configurationScope: "PROJECT_OVERRIDE",
    workspaceBindingId: null,
    workspaceBindingVersion: null,
    version: 4,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now,
    routes: [],
    ...overrides
  };
}

function projectRoute(
  position: number,
  provider: "XMLSTOCK" | "ARSENKIN",
  status: "ACTIVE" | "DEGRADED" | "LOW_BALANCE",
  routingScope: "PROJECT_OVERRIDE" | "WORKSPACE_DEFAULT" = "PROJECT_OVERRIDE"
): unknown {
  const suffix = String(position + 10).padStart(12, "0");
  return {
    id: `0190abcd-1000-7000-8000-${suffix}`,
    workspaceId,
    projectId,
    bindingId,
    position,
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId: `0190abcd-1000-7000-9000-${suffix}`,
    routingScope,
    workspaceRouteId: routingScope === "PROJECT_OVERRIDE" ? null : `0190abcd-1000-7000-a000-${suffix}`,
    createdAt: now,
    updatedAt: now,
    credential: credential(provider, status, suffix)
  };
}

function credential(
  provider: "XMLSTOCK" | "ARSENKIN",
  status: "ACTIVE" | "DEGRADED" | "LOW_BALANCE",
  suffix: string
): unknown {
  return {
    id: `0190abcd-1000-7000-9000-${suffix}`,
    workspaceId,
    provider,
    label: `${provider} test`,
    mode: "BYOK_API_KEY",
    status,
    capabilities: ["SERP_RANK_TRACKING"],
    deletedAt: null
  };
}

function workspaceBinding(): unknown {
  const route = {
    id: "0190abcd-1000-7000-b000-000000000001",
    workspaceId,
    bindingId: workspaceBindingId,
    position: 0,
    credentialId: "0190abcd-1000-7000-9000-000000000010",
    createdAt: now,
    updatedAt: now,
    credential: credential("XMLSTOCK", "ACTIVE", "000000000010")
  };
  return {
    id: workspaceBindingId,
    workspaceId,
    capability: "SERP_RANK_TRACKING",
    enabled: true,
    fallbackMode: "NONE",
    fallbackReasons: [],
    version: 7,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now,
    routes: [route]
  };
}
