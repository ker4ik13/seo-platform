import assert from "node:assert/strict";
import test from "node:test";
import { semanticOperationScopePageInput } from "./semantic-operation-scope-query.ts";

test("builds one lightweight operation-scope page for multiple folders", () => {
  const input = semanticOperationScopePageInput(["folder-a", "folder-b"]);

  assert.deepEqual(input, { groupIds: ["folder-a", "folder-b"] });
});

test("keeps a single folder and pagination cursor", () => {
  const input = semanticOperationScopePageInput(["folder-a"], "cursor-value");

  assert.deepEqual(input, {
    groupIds: ["folder-a"],
    cursor: "cursor-value"
  });
});

test("builds the project-wide first page without empty fields", () => {
  const input = semanticOperationScopePageInput(undefined);

  assert.deepEqual(input, {});
});
