import assert from "node:assert/strict";
import test from "node:test";
import {
  semanticOperationScopeCountPageSize,
  semanticOperationScopePageSize,
  semanticOperationScopeQuery
} from "./semantic-operation-scope-query.ts";

test("builds one bounded union query for multiple operation folders", () => {
  const query = semanticOperationScopeQuery(["folder-a", "folder-b"]);

  assert.equal(query.get("limit"), String(semanticOperationScopeCountPageSize));
  assert.equal(query.get("sort"), "CREATED_ASC");
  assert.equal(query.get("groupId"), null);
  assert.equal(query.get("groupIds"), "folder-a,folder-b");
});

test("uses the canonical single-folder filter and keeps pagination cursor", () => {
  const query = semanticOperationScopeQuery(["folder-a"], "cursor-value");

  assert.equal(query.get("groupId"), "folder-a");
  assert.equal(query.get("groupIds"), null);
  assert.equal(query.get("cursor"), "cursor-value");
  assert.equal(query.get("limit"), String(semanticOperationScopePageSize));
});

test("builds the project-wide query without a folder filter", () => {
  const query = semanticOperationScopeQuery(undefined);

  assert.equal(query.get("groupId"), null);
  assert.equal(query.get("groupIds"), null);
});
