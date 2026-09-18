import assert from "node:assert/strict";
import test from "node:test";
import { semanticOperationScopePageInput, semanticOperationScopeResolutionKey } from "./semantic-operation-scope-query.ts";

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

test("scope resolution identity ignores recreated arrays with the same content", () => {
  const first = semanticOperationScopeResolutionKey({
    mode: "ALL",
    selectedGroupIds: ["b", "a"],
    descendantGroupIds: [],
    resolvedGroupIds: ["child", "root"],
    querySelections: [{ id: "keyword-b", version: 2 }, { id: "keyword-a", version: 1 }]
  });
  const second = semanticOperationScopeResolutionKey({
    mode: "ALL",
    selectedGroupIds: ["a", "b"],
    descendantGroupIds: [],
    resolvedGroupIds: ["root", "child"],
    querySelections: [{ id: "keyword-a", version: 1 }, { id: "keyword-b", version: 2 }]
  });
  assert.equal(first, second);
});
