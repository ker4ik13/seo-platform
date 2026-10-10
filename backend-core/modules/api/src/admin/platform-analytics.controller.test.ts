import assert from "node:assert/strict";
import test from "node:test";
import { PlatformAnalyticsController } from "./platform-analytics.controller.js";
import type { PlatformAdminRequest } from "./platform-role.guard.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
test("analytics finance scope is derived from verified roles rather than query fields", async () => {
  const requested: boolean[] = [];
  const controller = new PlatformAnalyticsController({
    report: async (_query: unknown, finance: boolean) => {
      requested.push(finance);
      return { finance };
    },
  } as never);
  const principal = { userId: "test" } as AuthenticatedPrincipal;
  for (const platformRoles of [
    ["ANALYST"],
    ["OPERATIONS"],
    ["FINANCE"],
    ["SUPER_ADMIN"],
  ] as const)
    await controller.report(
      { days: "30", includeInternal: "false" },
      { id: "request", platformRoles } as unknown as PlatformAdminRequest,
      principal,
    );
  assert.deepEqual(requested, [false, false, true, true]);
  await assert.rejects(
    controller.report(
      { days: "30", finance: true },
      {
        id: "request",
        platformRoles: ["ANALYST"],
      } as unknown as PlatformAdminRequest,
      principal,
    ),
  );
});
