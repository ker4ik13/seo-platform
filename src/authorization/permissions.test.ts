import assert from "node:assert/strict";
import test from "node:test";
import { hasSystemPermission } from "./permissions.js";

test("owner has every permission", () => {
  assert.equal(hasSystemPermission("OWNER", "workspace.delete"), true);
  assert.equal(hasSystemPermission("OWNER", "billing.manage_plan"), true);
});

test("client cannot mutate SEO data or see billing", () => {
  assert.equal(hasSystemPermission("CLIENT", "report.view"), true);
  assert.equal(hasSystemPermission("CLIENT", "semantic.update"), false);
  assert.equal(hasSystemPermission("CLIENT", "billing.view_balance"), false);
});

test("unknown and custom roles are default deny", () => {
  assert.equal(hasSystemPermission("CUSTOM_EDITOR", "project.view"), false);
  assert.equal(hasSystemPermission("UNKNOWN", "workspace.view"), false);
});
