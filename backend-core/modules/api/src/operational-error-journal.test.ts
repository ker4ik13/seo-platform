import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "./generated/prisma/client.js";
import { OperationalErrorJournal } from "./operational-error-journal.js";

test("stores only the bounded alert envelope with searchable project and operation IDs", async () => {
  const writes: unknown[] = [];
  const cutoffs: unknown[] = [];
  let cleanupBatches = 0;
  let disconnected = false;
  const journal = new OperationalErrorJournal(
    "postgresql://journal.invalid/test",
    "production",
    "0.2.1",
    {
      operationalErrorEvent: {
        create: async (input: unknown) => {
          writes.push(input);
          return input;
        }
      },
      $executeRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => {
        cutoffs.push(values[0]);
        return cleanupBatches++ === 0 ? 500 : 0;
      },
      $disconnect: async () => { disconnected = true; }
    } as unknown as Pick<PrismaClient, "operationalErrorEvent" | "$executeRaw" | "$disconnect">
  );
  const projectId = "01900000-0000-7000-8000-000000000001";
  const jobId = "01900000-0000-7000-8000-000000000002";
  await journal.record({
    version: 1,
    service: "backend-execution",
    source: "rank-worker-2",
    code: "CHILD_ERROR_LOG",
    severity: "ERROR",
    fingerprint: "0123456789abcdef",
    context: { projectId, jobId, errorCode: "P2010", log: "free text must not be persisted" }
  });
  assert.deepEqual(writes, [{ data: {
    environment: "production",
    serviceVersion: "0.2.1",
    service: "backend-execution",
    source: "rank-worker-2",
    code: "CHILD_ERROR_LOG",
    severity: "ERROR",
    fingerprint: "0123456789abcdef",
    projectId,
    operationId: jobId,
    context: { projectId, jobId, errorCode: "P2010" }
  } }]);
  await journal.record({
    version: 1,
    service: "backend-execution",
    source: "rank-worker-2",
    code: "CHILD_ERROR_LOG",
    severity: "ERROR",
    context: { log: "Unable to persist result: P2010 private query text" }
  });
  assert.deepEqual((writes[1] as { data: { context: unknown } }).data.context, {
    errorCode: "P2010"
  });
  assert.equal(await journal.purgeExpired(new Date("2026-10-20T12:00:00.000Z")), 500);
  assert.deepEqual(cutoffs, [
    new Date("2026-10-05T12:00:00.000Z"),
    new Date("2026-10-05T12:00:00.000Z")
  ]);
  await journal.close();
  assert.equal(disconnected, true);
});
