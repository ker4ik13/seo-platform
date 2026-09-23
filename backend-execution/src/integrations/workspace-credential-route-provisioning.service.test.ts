import assert from "node:assert/strict";
import test from "node:test";
import { connectorFallbackReasons } from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import { WorkspaceCredentialRouteProvisioningService } from "./workspace-credential-route-provisioning.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const actorId = "01900000-0000-7000-8000-000000000002";
const credentialId = "01900000-0000-7000-8000-000000000003";

test("appends a new credential last to every compatible workspace route", async () => {
  const bindings = new Map<string, Record<string, unknown>>([
    ["SERP_RANK_TRACKING", {
      id: "01900000-0000-7000-8000-000000000010",
      workspaceId,
      capability: "SERP_RANK_TRACKING",
      fallbackMode: "NONE",
      fallbackReasons: [],
      version: 1
    }]
  ]);
  const routes = [{
    id: "01900000-0000-7000-8000-000000000020",
    workspaceId,
    bindingId: "01900000-0000-7000-8000-000000000010",
    credentialId: "01900000-0000-7000-8000-000000000099",
    position: 0
  }];
  const bindingUpdates: unknown[] = [];
  const transaction = {
    $queryRaw: async () => [{ locked: true }],
    workspaceConnectorBinding: {
      findUnique: async ({ where }: any) =>
        bindings.get(where.workspaceId_capability.capability) ?? null,
      create: async ({ data }: any) => {
        const binding = {
          ...data,
          id: `01900000-0000-7000-8000-0000000000${20 + bindings.size}`,
          version: 1
        };
        bindings.set(data.capability, binding);
        return binding;
      },
      update: async (value: unknown) => {
        bindingUpdates.push(value);
        return value;
      }
    },
    workspaceConnectorRoute: {
      findFirst: async ({ where }: any) => routes.find((route) =>
        route.bindingId === where.bindingId &&
        route.credentialId === where.credentialId
      ) ?? null,
      aggregate: async ({ where }: any) => ({
        _max: {
          position: routes
            .filter((route) => route.bindingId === where.bindingId)
            .reduce<number | null>(
              (maximum, route) => maximum === null
                ? route.position
                : Math.max(maximum, route.position),
              null
            )
        }
      }),
      create: async ({ data }: any) => {
        const route = {
          ...data,
          id: `01900000-0000-7000-8000-0000000000${30 + routes.length}`
        };
        routes.push(route);
        return route;
      }
    }
  };
  const prisma = {
    $transaction: async (run: (client: typeof transaction) => Promise<void>) =>
      run(transaction)
  } as unknown as PrismaService;

  await new WorkspaceCredentialRouteProvisioningService(prisma).append({
    workspaceId,
    actorId,
    credentialId,
    capabilities: ["WORDSTAT", "SERP_RANK_TRACKING", "WORDSTAT"]
  });

  const added = routes.filter((route) => route.credentialId === credentialId);
  assert.equal(added.length, 2);
  assert.equal(
    added.find((route) => route.bindingId === "01900000-0000-7000-8000-000000000010")?.position,
    1
  );
  assert.equal(
    added.find((route) => route.bindingId !== "01900000-0000-7000-8000-000000000010")?.position,
    0
  );
  assert.deepEqual(bindingUpdates, [{
    where: { id: "01900000-0000-7000-8000-000000000010" },
    data: {
      fallbackMode: "NEXT_AVAILABLE",
      fallbackReasons: [...connectorFallbackReasons],
      updatedBy: actorId,
      version: { increment: 1 }
    }
  }]);
});
