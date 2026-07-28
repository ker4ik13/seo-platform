import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageWorkspaceIntegrations,
  canViewWorkspaceIntegrations
} from "./app-permissions.ts";

test("integration navigation follows the current system role matrix", () => {
  for (const role of ["OWNER", "ADMIN", "SEO_LEAD", "SEO_SPECIALIST"]) {
    assert.equal(canViewWorkspaceIntegrations(role), true);
  }
  for (const role of ["ANALYST", "CONTENT_EDITOR", "CLIENT", "VIEWER"]) {
    assert.equal(canViewWorkspaceIntegrations(role), false);
  }
});

test("only owner and admin can mutate workspace credentials", () => {
  assert.equal(canManageWorkspaceIntegrations("OWNER"), true);
  assert.equal(canManageWorkspaceIntegrations("ADMIN"), true);
  assert.equal(canManageWorkspaceIntegrations("SEO_LEAD"), false);
  assert.equal(canManageWorkspaceIntegrations(undefined), false);
});
