import assert from "node:assert/strict";
import test from "node:test";
import {
  hasEffectiveProjectPermission,
  hasProjectAccessPermission,
  hasSystemPermission,
  isReadOnlySafePermission
} from "./permissions.js";

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

test("project assignment can only narrow workspace role permissions", () => {
  assert.equal(hasProjectAccessPermission("NONE", "project.view"), false);
  assert.equal(hasProjectAccessPermission("VIEWER", "semantic.view"), true);
  assert.equal(hasProjectAccessPermission("VIEWER", "semantic.update"), false);
  assert.equal(hasProjectAccessPermission("MEMBER", "semantic.update"), true);
  assert.equal(
    hasProjectAccessPermission("MEMBER", "project.manage_access"),
    false
  );
  assert.equal(
    hasProjectAccessPermission("MANAGER", "project.manage_access"),
    true
  );
  assert.equal(
    hasProjectAccessPermission("MANAGER", "billing.manage_plan"),
    false
  );
});

test("effective project permission intersects system role and assignment", () => {
  assert.equal(
    hasEffectiveProjectPermission(
      "ADMIN",
      "MANAGER",
      "integration.update"
    ),
    true
  );
  assert.equal(
    hasEffectiveProjectPermission(
      "ADMIN",
      "VIEWER",
      "integration.update"
    ),
    false
  );
  assert.equal(
    hasEffectiveProjectPermission(
      "SEO_LEAD",
      "MANAGER",
      "integration.update"
    ),
    false
  );
  assert.equal(
    hasEffectiveProjectPermission(
      "CUSTOM",
      undefined,
      "integration.view"
    ),
    false
  );
});

test("read-only mode allows viewing, exporting and balance recovery only", () => {
  assert.equal(isReadOnlySafePermission("semantic.view"), true);
  assert.equal(isReadOnlySafePermission("semantic.export"), true);
  assert.equal(isReadOnlySafePermission("billing.top_up"), true);
  assert.equal(isReadOnlySafePermission("semantic.import"), false);
  assert.equal(isReadOnlySafePermission("collector.run"), false);
});
