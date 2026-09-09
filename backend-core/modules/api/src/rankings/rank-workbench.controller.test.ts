import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA, MODULE_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { CsrfSessionGuard, SessionAuthGuard } from "../identity/session-auth.guard.js";
import { RankingModule } from "./ranking.module.js";
import { RankWorkbenchController } from "./rank-workbench.controller.js";

test("protects rank reports and destructive history removal at their exact boundaries", () => {
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, RankWorkbenchController),
    "api/v1/projects/:projectId/rank-workbench"
  );
  for (const method of [
    RankWorkbenchController.prototype.positions,
    RankWorkbenchController.prototype.serp
  ]) {
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, method), "ranking.view");
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
      SessionAuthGuard,
      CsrfSessionGuard,
      TenantPermissionGuard
    ]);
  }
  const mergeSettings = RankWorkbenchController.prototype.mergeSettings;
  assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, mergeSettings), "ranking.view");
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, mergeSettings), [
    SessionAuthGuard,
    TenantPermissionGuard
  ]);
  for (const method of [
    RankWorkbenchController.prototype.createMerge,
    RankWorkbenchController.prototype.removeMerge
  ]) {
    assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, method), "ranking.configure");
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
      SessionAuthGuard,
      CsrfSessionGuard,
      TenantPermissionGuard
    ]);
  }
  const remove = RankWorkbenchController.prototype.deleteDimensionHistory;
  assert.equal(Reflect.getMetadata(REQUIRED_PERMISSION, remove), "ranking.configure");
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, remove), [
    SessionAuthGuard,
    CsrfSessionGuard,
    TenantPermissionGuard
  ]);
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    RankingModule
  ) as readonly unknown[];
  assert.ok(controllers.includes(RankWorkbenchController));
});
