import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageWorkspaceTeam,
  canManageWorkspaceIntegrations,
  canTestWorkspaceIntegrations,
  canUpdateProject,
  canViewWorkspaceTeam,
  canViewProjectIntegrations,
  canViewWorkspaceIntegrations
} from "./app-permissions.ts";

test("team navigation and mutations follow member permissions", () => {
  for (const role of ["OWNER", "ADMIN", "SEO_LEAD"]) {
    assert.equal(canViewWorkspaceTeam(role), true);
  }
  for (const role of ["SEO_SPECIALIST", "ANALYST", "CLIENT", "VIEWER"]) {
    assert.equal(canViewWorkspaceTeam(role), false);
  }
  assert.equal(canManageWorkspaceTeam("OWNER"), true);
  assert.equal(canManageWorkspaceTeam("ADMIN"), true);
  assert.equal(canManageWorkspaceTeam("SEO_LEAD"), false);
  assert.equal(canManageWorkspaceTeam(undefined), false);
});

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
