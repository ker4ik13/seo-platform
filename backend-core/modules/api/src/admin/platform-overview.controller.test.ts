import assert from "node:assert/strict";
import test from "node:test";
import { PlatformOverviewController } from "./platform-overview.controller.js";
test("operational overview does not expose cached finance data to support", async () => {
  const cached = { generatedAt: new Date().toISOString(), finance: { received30dMinor: 123456 }, users: { total: 3 } };
  const controller = new PlatformOverviewController({ overview: async () => cached } as never);
  const support = await controller.overview({ id: "support-request", platformRoles: ["SUPPORT"] } as never, { userId: "support" } as never);
  assert.equal("finance" in support.data, false);
  const finance = await controller.overview({ id: "finance-request", platformRoles: ["FINANCE"] } as never, { userId: "finance" } as never);
  assert.ok("finance" in finance.data);
  assert.deepEqual(finance.data.finance, cached.finance, "Redaction must not mutate the cached owner projection");
});
