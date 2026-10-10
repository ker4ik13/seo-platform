import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { parsePageStatusInput, parsePageStatusJobSummary } from "./page-status-jobs.js";
test("page bulk action and strict result consumer enforce bounded, exact scopes", () => {
  const id = randomUUID();
  assert.deepEqual(parsePageStatusInput({ operation: "archive", pageIds: [id] }), { operation: "archive", pageIds: [id] });
  assert.deepEqual(parsePageStatusInput({ operation: "restore", pathPrefix: "/ai" }), { operation: "restore", pathPrefix: "/ai" });
  for (const value of [{ operation: "delete", pageIds: [id] }, { operation: "archive", pageIds: [] }, { operation: "archive", pageIds: [id, id] }, { operation: "archive", pageIds: [id], pathPrefix: "/" }, { operation: "archive", pathPrefix: "/ai?foo" }, { operation: "archive", pathPrefix: "/", workspaceId: id }]) assert.throws(() => parsePageStatusInput(value));
  const result = { id, workspaceId: randomUUID(), projectId: randomUUID(), status: "COMPLETED", processed: 2, total: 2, changed: 1, blocked: 1 };
  assert.deepEqual(parsePageStatusJobSummary(result), result);
  assert.throws(() => parsePageStatusJobSummary({ ...result, secret: "value" }));
  assert.throws(() => parsePageStatusJobSummary({ ...result, total: 1 }));
});
