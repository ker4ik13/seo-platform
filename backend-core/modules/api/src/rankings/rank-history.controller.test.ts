import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  MODULE_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type { RankHistoryItem } from "@seo-platform/contracts";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { RankHistoryController } from "./rank-history.controller.js";
import { RankingModule } from "./ranking.module.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const contextId = "01900000-0000-7000-8000-000000000004";
const keywordId = "01900000-0000-7000-8000-000000000005";
const snapshotId = "01900000-0000-7000-8000-000000000006";
const jobId = "01900000-0000-7000-8000-000000000007";
const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000008",
  sessionFamilyId: "01900000-0000-7000-8000-000000000009",
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 900_000)
};
const item: RankHistoryItem = {
  snapshotId,
  keywordId,
  trackingContextId: contextId,
  configurationVersion: 2,
  provider: "ARSENKIN",
  connectorVersion: "arsenkin.positions.v1",
  observedAt: "2026-07-29T12:00:00.000Z",
  storedAt: "2026-07-29T12:00:01.000Z",
  jobId,
  dataQualityFlags: [],
  found: false,
  position: null
};

test("registers a session-protected ranking.view history route", () => {
  const method = RankHistoryController.prototype.list;
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, RankHistoryController),
    "api/v1/projects/:projectId/rank-history"
  );
  assert.equal(
    Reflect.getMetadata(REQUIRED_PERMISSION, method),
    "ranking.view"
  );
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
    SessionAuthGuard,
    TenantPermissionGuard
  ]);
  const controllers = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    RankingModule
  ) as readonly unknown[];
  assert.ok(controllers.includes(RankHistoryController));
});

test("keeps archived and billing read-only rank history readable", async () => {
  let captured: readonly unknown[] | undefined;
  const controller = new RankHistoryController({
    listRankHistory: async (...args: unknown[]) => {
      captured = args;
      return {
        data: [item],
        page: { hasNext: false }
      };
    }
  } as unknown as SeoDataClient);

  const response = await controller.list(
    {
      observedFrom: "2026-07-01T00:00:00.000Z",
      observedBefore: "2026-08-01T00:00:00.000Z",
      trackingContextId: contextId.toUpperCase()
    },
    request(),
    principal
  );

  assert.deepEqual(captured?.[0], {
    tenant: {
      workspaceId,
      workspaceStatus: "READ_ONLY",
      projectId,
      projectStatus: "ARCHIVED",
      roleCode: "OWNER"
    },
    actorId,
    requestId: "request-rank-history-001"
  });
  assert.deepEqual(captured?.[1], {
    observedFrom: "2026-07-01T00:00:00.000Z",
    observedBefore: "2026-08-01T00:00:00.000Z",
    trackingContextId: contextId,
    limit: 100
  });
  assert.deepEqual(response, {
    data: [item],
    page: { hasNext: false },
    meta: { requestId: "request-rank-history-001" }
  });
});

function request(): TenantRequest {
  return {
    id: "request-rank-history-001",
    headers: {},
    tenantAuthorization: {
      workspaceId,
      workspaceStatus: "READ_ONLY",
      projectId,
      projectStatus: "ARCHIVED",
      roleCode: "OWNER"
    }
  } as TenantRequest;
}
