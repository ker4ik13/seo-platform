import assert from "node:assert/strict";
import test from "node:test";
import { OperationCancellationService } from "./operation-cancellation.service.js";

test("admin import cancellation delegates to the owning workflow with the actual admin and request", async () => {
  const scope = { workspaceId: "workspace", projectId: "project" };
  let command: unknown;
  const args = [
    { job: { findUnique: async () => null }, semanticImport: { findUnique: async () => scope } },
    {}, {}, {}, {}, {}, {}, {},
    { cancel: async (...input: unknown[]) => { command = input; } }
  ] as unknown as ConstructorParameters<typeof OperationCancellationService>;
  await new OperationCancellationService(...args).cancel("import", "admin", "request");
  assert.deepEqual(command, ["import", { ...scope, actorId: "admin" }, "request"]);
});
