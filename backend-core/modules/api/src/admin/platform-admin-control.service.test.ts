import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PlatformAdminControlService } from "./platform-admin-control.service.js";

test("workspace unblock respects billing read-only state and replays the same receipt", async () => {
  const id = randomUUID();
  const actorId = randomUUID();
  let status = "SUSPENDED";
  let version = 2;
  let receipt: Record<string, unknown> | undefined;
  let updates = 0;
  const tx = {
    $executeRaw: async () => 1,
    workspace: {
      findUnique: async () => ({ status, version }),
      update: async ({ data }: { data: { status: string } }) => {
        updates += 1;
        status = data.status;
        version += 1;
        return { id, status, version };
      }
    },
    platformAdminCommandReceipt: {
      findUnique: async () => receipt,
      create: async ({ data }: { data: Record<string, unknown> }) => { receipt = data; }
    }
  };
  const db = { $transaction: async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx) };
  const recorded: string[] = [];
  const audit = { record: async () => { recorded.push("audit"); } };
  const outbox = { event: async () => { recorded.push("outbox"); } };
  const entitlements = { snapshotInTransaction: async () => undefined };
  const service = new PlatformAdminControlService(db as never, audit as never, {} as never, outbox as never, entitlements as never);
  const command = { status: "ACTIVE", confirmId: id, confirmed: true, reason: "Проверка восстановления" } as const;
  const context = { requestId: randomUUID() } as never;
  const first = await service.changeState("WORKSPACE", id, command, 2, actorId, randomUUID(), context);
  assert.deepEqual(first, { id, status: "READ_ONLY", version: 3 });
  assert.deepEqual(recorded, ["audit", "outbox"]);
  const replay = await service.changeState("WORKSPACE", id, command, 2, actorId, String(receipt?.idempotencyKey), context);
  assert.deepEqual(replay, first);
  assert.equal(updates, 1);
});

test("admin cannot suspend their own user account", async () => {
  const id = randomUUID();
  const service = new PlatformAdminControlService({} as never, {} as never, {} as never, {} as never, {} as never);
  await assert.rejects(
    service.changeState("USER", id, { status: "SUSPENDED", confirmId: id, confirmed: true, reason: "Проверка самоблокировки" }, 1, id, randomUUID(), {} as never),
    /Нельзя заблокировать собственный аккаунт/u
  );
});
