import assert from "node:assert/strict";
import test from "node:test";
import type { AuditService } from "../audit/audit.service.js";
import type { JobsClient } from "../jobs/jobs.client.js";
import { PlatformAdminWorkerNodeService } from "./platform-admin-worker-nodes.service.js";

test("worker creation audits safe configuration without storing its one-time token", async () => {
  const token = `wn_${"a".repeat(43)}`;
  const events: unknown[] = [];
  const jobs = {
    async createWorkerNode() {
      return {
        node: { id: "01900000-0000-7000-8000-000000000001" },
        token
      };
    }
  } as unknown as JobsClient;
  const audit = {
    async record(value: unknown) { events.push(value); }
  } as unknown as AuditService;
  const service = new PlatformAdminWorkerNodeService(jobs, audit);
  const result = await service.create({
    name: "office-one", capabilities: ["RANK"],
    maxHttpSlots: 16, maxCpuSlots: 2
  }, "01900000-0000-7000-8000-000000000002", "request-1");
  assert.equal(result.token, token);
  assert.equal(events.length, 1);
  assert.equal(JSON.stringify(events).includes(token), false);
});
