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

test("worker removal goes through Jobs and records a safe audit event", async () => {
  const id = "01900000-0000-7000-8000-000000000001", removed = { id, deletedAt: new Date().toISOString() };
  const events: unknown[] = [];
  const jobs = { removeWorkerNode: async (_actor: string, _request: string, target: string) => { assert.equal(target, id); return removed; } } as unknown as JobsClient;
  const service = new PlatformAdminWorkerNodeService(jobs, { record: async (event: unknown) => { events.push(event); } } as AuditService);
  assert.deepEqual(await service.remove(id, "actor", "request"), removed);
  assert.equal((events[0] as { action: string }).action, "platform_admin.worker_node.deleted");
});
