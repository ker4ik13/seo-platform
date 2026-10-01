import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import type { ObjectStoragePort } from "../storage/object-storage.port.js";
import { RemoteWorkRetentionService } from "./remote-work-retention.service.js";

test("transport cleanup preserves canonical exports and only scans closed owners", async () => {
  const removed: string[] = [], objects: string[] = [];
  const prisma = {
    $queryRaw: async (query: TemplateStringsArray) => {
      assert.match(query.join(""), /j\.status IN \('COMPLETED','CANCELLED','EXPIRED'\)/u);
      return [
        { id: "one", workspaceId: "workspace", operationId: "operation", command: "PROVIDER_HTTP", resultObjectKey: "remote-results/workspace/operation/one/result", resultMultipartId: null, inputObjectKey: null },
        { id: "two", workspaceId: "workspace", operationId: "operation", command: "EXPORT_FILE", resultObjectKey: "workspace/project/semantic-exports/operation/attempt-1.xlsx", resultMultipartId: "completed-upload", inputObjectKey: "remote-inputs/workspace/operation/input.jsonl" }
      ];
    },
    remoteWorkTask: { deleteMany: async ({where}: {where: {id: {in: string[]}}}) => { removed.push(...where.id.in); return { count: 2 }; } }
  } as unknown as PrismaService;
  const storage = { deleteObject: async (_bucket: string, key: string) => { objects.push(key); } } as ObjectStoragePort;
  await new RemoteWorkRetentionService(prisma, storage).sweep(new Date());
  assert.deepEqual(removed, ["one","two"]);
  assert.deepEqual(objects, ["remote-results/workspace/operation/one/result","remote-inputs/workspace/operation/input.jsonl"]);
});

test("an artifact deletion failure retains its receipt for a later bounded sweep", async () => {
  let deletes = 0;
  const prisma = { $queryRaw: async () => [{ id: "one", workspaceId: "workspace", operationId: "operation", command: "IMPORT_ROWS", resultObjectKey: "remote-results/workspace/operation/one/result", resultMultipartId: null, inputObjectKey: null }], remoteWorkTask: { deleteMany: async () => { deletes++; } } } as unknown as PrismaService;
  const storage = { deleteObject: async () => { throw new Error("storage unavailable"); } } as unknown as ObjectStoragePort;
  await new RemoteWorkRetentionService(prisma, storage).sweep(new Date());
  assert.equal(deletes, 0);
});
