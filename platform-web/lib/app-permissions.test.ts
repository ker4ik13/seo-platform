import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageWorkspaceIntegrations,
  canTestWorkspaceIntegrations,
  canUpdateProject,
  canViewProjectIntegrations,
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

test("SEO roles can run credential checks", () => {
  for (const role of ["OWNER", "ADMIN", "SEO_LEAD", "SEO_SPECIALIST"]) {
    assert.equal(canTestWorkspaceIntegrations(role), true);
  }
  for (const role of ["ANALYST", "CONTENT_EDITOR", "CLIENT", "VIEWER"]) {
    assert.equal(canTestWorkspaceIntegrations(role), false);
  }
});

test("project permissions intersect the workspace role with explicit access", () => {
  assert.equal(canUpdateProject("OWNER"), true);
  assert.equal(canUpdateProject("OWNER", "VIEWER"), false);
  assert.equal(canUpdateProject("OWNER", "MEMBER"), false);
  assert.equal(canUpdateProject("SEO_SPECIALIST", "MANAGER"), true);
  assert.equal(canUpdateProject("VIEWER", "MANAGER"), false);
  assert.equal(canViewProjectIntegrations("SEO_LEAD", "MANAGER"), true);
  assert.equal(canViewProjectIntegrations("SEO_LEAD", "MEMBER"), false);
  assert.equal(canViewProjectIntegrations("ANALYST", "MANAGER"), false);
});
