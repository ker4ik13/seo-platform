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

test("uses the next workspace route for an explicitly allowed low-balance fallback", async () => {
  const binding = inheritedProjectBinding({
    fallbackMode: "NEXT_AVAILABLE",
    fallbackReasons: ["LOW_BALANCE"],
    routes: [
      projectRoute(0, "XMLSTOCK", "LOW_BALANCE", "WORKSPACE_DEFAULT"),
      projectRoute(1, "ARSENKIN", "ACTIVE", "WORKSPACE_DEFAULT")
    ]
  });
  const result = await service(binding, workspaceBinding()).resolve(
    workspaceId,
    projectId,
    "SERP_RANK_TRACKING",
    actorId
  );

  assert.equal(result.provider, "ARSENKIN");
  assert.equal(result.routingScope, "WORKSPACE_DEFAULT");
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
        routingScope: "WORKSPACE_DEFAULT",
        outcome: "FALLBACK",
        reasonCode: "LOW_BALANCE"
      },
      {
        provider: "ARSENKIN",
        routingScope: "WORKSPACE_DEFAULT",
        outcome: "SELECTED",
        reasonCode: undefined
      }
    ]
  );
});

test("skips an active XMLStock credential that cannot fund the complete Wordstat operation", async () => {
  const primary = projectRoute(
    0,
    "XMLSTOCK",
    "ACTIVE",
    "WORKSPACE_DEFAULT",
    xmlStockWordstatCredential("1", "000000000010")
  );
  const reserve = projectRoute(
    1,
    "XMLSTOCK",
    "ACTIVE",
    "WORKSPACE_DEFAULT",
    xmlStockWordstatCredential("4150.99", "000000000011")
  );
  const binding = inheritedProjectBinding({
    capability: "WORDSTAT",
    fallbackMode: "NEXT_AVAILABLE",
    fallbackReasons: ["LOW_BALANCE"],
    routes: [primary, reserve]
  });
  const workspace = workspaceBinding({
    capability: "WORDSTAT",
    fallbackMode: "NEXT_AVAILABLE",
    fallbackReasons: ["LOW_BALANCE"],
    routes: [workspaceRoute(0, primary), workspaceRoute(1, reserve)]
  });

  const configured = await service(binding, workspace).resolve(
    workspaceId,
    projectId,
    "WORDSTAT",
    actorId
  );
  assert.equal(
    configured.credentialId,
    "0190abcd-1000-7000-9000-000000000010",
    "saving a route must not depend on the balance needed by a future operation"
  );

  const result = await service(binding, workspace).resolve(
    workspaceId,
    projectId,
    "WORDSTAT",
    actorId,
    undefined,
    undefined,
    {
      xmlStock: {
        product: "WORDSTAT",
        requestCount: 10_926
      }
    }
  );

  assert.equal(result.credentialId, "0190abcd-1000-7000-9000-000000000011");
  assert.equal(result.xmlStockPricing?.tariffCode, "OPTIMAL");
  assert.deepEqual(result.attempts.map(({ outcome, reasonCode }) => ({
    outcome,
    reasonCode
  })), [
    { outcome: "FALLBACK", reasonCode: "LOW_BALANCE" },
    { outcome: "SELECTED", reasonCode: undefined }
  ]);
});

test("starts an explicit launch from the selected credential without mutating the binding", async () => {
  const first = projectRoute(0, "XMLSTOCK", "ACTIVE", "WORKSPACE_DEFAULT");
  const second = projectRoute(1, "ARSENKIN", "ACTIVE", "WORKSPACE_DEFAULT");
  const selectedCredentialId = (second as { credentialId: string }).credentialId;
  const binding = inheritedProjectBinding({
    fallbackMode: "NEXT_AVAILABLE",
    fallbackReasons: ["RETRYABLE_PROVIDER_ERROR"],
    routes: [first, second]
  });

  const result = await service(binding, workspaceBinding()).resolve(
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
  const binding = inheritedProjectBinding({
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
  const binding = inheritedProjectBinding({
    fallbackMode: "NEXT_AVAILABLE",
    fallbackReasons: ["RETRYABLE_PROVIDER_ERROR"],
    routes: [
      projectRoute(0, "XMLSTOCK", "DEGRADED", "WORKSPACE_DEFAULT"),
      projectRoute(1, "ARSENKIN", "ACTIVE", "WORKSPACE_DEFAULT")
    ]
  });

  const result = await service(binding, workspaceBinding()).resolve(
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
  const binding = inheritedProjectBinding({
    fallbackMode: "NEXT_AVAILABLE",
    fallbackReasons: ["RATE_LIMITED"],
    routes: [
      projectRoute(0, "XMLSTOCK", "LOW_BALANCE", "WORKSPACE_DEFAULT"),
      projectRoute(1, "ARSENKIN", "ACTIVE", "WORKSPACE_DEFAULT")
    ]
  });

  await assert.rejects(
    service(binding, workspaceBinding()).resolve(
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

test("does not execute a legacy project override without a workspace route", async () => {
  const binding = projectBinding({
    routes: [projectRoute(0, "XMLSTOCK", "ACTIVE")]
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
      assert.equal((error.getResponse() as { code?: string }).code, "CONNECTOR_NOT_READY");
      return true;
    }
  );
});

test("allows disabling a workspace route whose credential became degraded", async () => {
  const credentialValue = credential("XMLSTOCK", "DEGRADED", "000000000010");
  const createdBinding = {
    id: workspaceBindingId,
    workspaceId,
    capability: "SERP_RANK_TRACKING",
    enabled: false,
    fallbackMode: "NONE",
    fallbackReasons: [],
    version: 1,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now
  };
  const transaction = {
    integrationCredential: { findMany: async () => [credentialValue] },
    workspaceConnectorBinding: {
      findUnique: async () => null,
      create: async () => createdBinding,
      findFirst: async () => ({
        ...createdBinding,
        routes: [{
          id: "0190abcd-1000-7000-b000-000000000001",
          workspaceId,
          bindingId: workspaceBindingId,
          position: 0,
          credentialId: "0190abcd-1000-7000-9000-000000000010",
          createdAt: now,
          updatedAt: now,
          credential: credentialValue
        }]
      })
    },
    workspaceConnectorRoute: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 1 })
    }
  };
  const routing = new WorkspaceConnectorRoutingService({
    $transaction: async (
      callback: (value: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService);

  const result = await routing.upsert({
    workspaceId,
    actorId,
    capability: "SERP_RANK_TRACKING",
    enabled: false,
    routes: [{
      position: 0,
      sourceKind: "WORKSPACE_CREDENTIAL",
      credentialId: "0190abcd-1000-7000-9000-000000000010"
    }],
    fallbackPolicy: { mode: "NONE", reasons: [] }
  });

  assert.equal(result.enabled, false);
  assert.equal(result.routes[0]?.availability, "CREDENTIAL_UNAVAILABLE");
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

function inheritedProjectBinding(
  overrides: Readonly<Record<string, unknown>> = {}
): unknown {
  return projectBinding({
    configurationScope: "WORKSPACE_INHERITED",
    workspaceBindingId,
    workspaceBindingVersion: 7,
    ...overrides
  });
}

function projectRoute(
  position: number,
  provider: "XMLSTOCK" | "ARSENKIN",
  status: "ACTIVE" | "DEGRADED" | "LOW_BALANCE",
  routingScope: "PROJECT_OVERRIDE" | "WORKSPACE_DEFAULT" = "PROJECT_OVERRIDE",
  credentialValue?: unknown
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
    credential: credentialValue ?? credential(provider, status, suffix)
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
    providerMeta: null,
    lastSuccessAt: null,
    deletedAt: null
  };
}

function xmlStockWordstatCredential(balance: string, suffix: string): unknown {
  return {
    ...(credential(
      "XMLSTOCK",
      "ACTIVE",
      suffix
    ) as Readonly<Record<string, unknown>>),
    capabilities: ["WORDSTAT"],
    providerMeta: {
      account: {
        requestLimit: 0,
        balance
      },
      xmlStockPricing: {
        tariffCode: balance === "1" ? "BASIC" : "OPTIMAL",
        currency: "RUB",
        priceUnit: "PER_1000_REQUESTS",
        pricesPerThousand: {
          YANDEX_SEARCH_API: balance === "1" ? "28" : "27",
          YANDEX_LIVE: balance === "1" ? "25" : "20",
          YANDEX_TURBO: balance === "1" ? "35" : "30",
          GOOGLE_LIVE: balance === "1" ? "25" : "20",
          WORDSTAT: balance === "1" ? "25" : "23"
        }
      }
    },
    lastSuccessAt: now
  };
}

function workspaceRoute(position: number, projectValue: unknown): unknown {
  const project = projectValue as Readonly<Record<string, unknown>>;
  return {
    id: `0190abcd-1000-7000-b000-${String(position + 1).padStart(12, "0")}`,
    workspaceId,
    bindingId: workspaceBindingId,
    position,
    credentialId: project.credentialId,
    createdAt: now,
    updatedAt: now,
    credential: project.credential
  };
}

function workspaceBinding(
  overrides: Readonly<Record<string, unknown>> = {}
): unknown {
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
    routes: [route],
    ...overrides
  };
}
