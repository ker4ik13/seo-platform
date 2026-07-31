import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type { AuditRecord } from "../audit/audit.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { SemanticClusterController } from "./semantic-cluster.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const clusterId = "01900000-0000-7000-8000-000000000004";
const pageId = "01900000-0000-7000-8000-000000000005";
const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000006",
  sessionFamilyId: "01900000-0000-7000-8000-000000000007",
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 900_000)
};

test("protects static cluster page mapping routes with bulk permission and CSRF", () => {
  const prototype = SemanticClusterController.prototype;
  for (const [method, path] of [
    [prototype.previewPageMapping, "page-mapping-preview"],
    [prototype.bulkUpdatePageMapping, "page-mapping-bulk"],
    [prototype.previewMerge, "merge-preview"],
    [prototype.merge, "merge"]
  ] as const) {
    assert.equal(Reflect.getMetadata(PATH_METADATA, method), path);
    assert.equal(
      Reflect.getMetadata(REQUIRED_PERMISSION, method),
      "semantic.bulk_edit"
    );
    assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, method), 200);
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
      CsrfSessionGuard,
      TenantPermissionGuard
    ]);
  }
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, prototype.update),
    ":clusterId"
  );
});

test("forwards an exact merge and audits the committed target", async () => {
  const sourceId = "01900000-0000-7000-8000-000000000008";
  const calls: unknown[][] = [];
  const audits: AuditRecord[] = [];
  const controller = new SemanticClusterController({
    previewSemanticClusterMerge: async (...args: unknown[]) => {
      calls.push(args);
      return {
        readiness: "READY",
        selectedClusterCount: 2,
        sourceClusterCount: 1,
        movedKeywordCount: 4,
        sourcePageConflictCount: 0,
        lockedClusterCount: 0,
        conflictedIds: [],
        unavailableIds: [],
        synchronousKeywordLimit: 450
      };
    },
    mergeSemanticClusters: async (...args: unknown[]) => {
      calls.push(args);
      return {
        targetCluster: { id: clusterId },
        mergedClusterIds: [sourceId],
        movedKeywordCount: 4
      };
    }
  } as unknown as SeoDataClient, {
    record: async (record: AuditRecord) => {
      audits.push(record);
    }
  } as unknown as AuditService);
  const body = {
    items: [
      { id: clusterId.toUpperCase(), version: 2 },
      { id: sourceId, version: 3 }
    ],
    targetClusterId: clusterId.toUpperCase()
  };

  await controller.previewMerge(body, request(), principal);
  await controller.merge(body, request(), principal);

  const normalized = {
    items: [
      { id: clusterId, version: 2 },
      { id: sourceId, version: 3 }
    ],
    targetClusterId: clusterId
  };
  assert.deepEqual(calls.map((args) => args[1]), [normalized, normalized]);
  assert.deepEqual(audits.map(({ action, outcome, resourceId }) => ({
    action,
    outcome,
    resourceId
  })), [
    {
      action: "semantic.cluster_merge.requested",
      outcome: "REQUESTED",
      resourceId: clusterId
    },
    {
      action: "semantic.cluster_merge.completed",
      outcome: "SUCCESS",
      resourceId: clusterId
    }
  ]);
});

test("forwards only normalized tenant context and audits a partial bulk apply", async () => {
  const calls: Array<{ method: string; args: readonly unknown[] }> = [];
  const audits: AuditRecord[] = [];
  const controller = new SemanticClusterController(
    {
      previewSemanticClusterPageMapping: async (...args: unknown[]) => {
        calls.push({ method: "preview", args });
        return {
          selected: 1,
          applicable: 1,
          skipped: 0,
          conflicted: 0,
          changes: [
            {
              clusterId,
              state: "APPLICABLE",
              expectedVersion: 2,
              currentVersion: 2,
              targetPrimaryPageId: pageId
            }
          ]
        };
      },
      bulkUpdateSemanticClusterPageMapping: async (...args: unknown[]) => {
        calls.push({ method: "apply", args });
        return {
          selected: 1,
          changed: 0,
          skipped: 0,
          conflicted: 1,
          updatedClusters: [],
          skippedIds: [],
          conflictedIds: [clusterId]
        };
      }
    } as unknown as SeoDataClient,
    {
      record: async (record: AuditRecord) => {
        audits.push(record);
      }
    } as unknown as AuditService
  );
  const body = {
    items: [{ id: clusterId.toUpperCase(), version: 2 }],
    primaryPageId: pageId.toUpperCase(),
    pageMappingSource: "MANUAL",
    pageMappingRationale: "  Совпадает интент  "
  };

  await controller.previewPageMapping(body, request(), principal);
  await controller.bulkUpdatePageMapping(body, request(), principal);

  const expectedContext = {
    tenant: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "OWNER"
    },
    actorId,
    requestId: "request-cluster-bulk-001"
  };
  const expectedInput = {
    items: [{ id: clusterId, version: 2 }],
    primaryPageId: pageId,
    pageMappingSource: "MANUAL",
    pageMappingRationale: "Совпадает интент"
  };
  assert.deepEqual(calls, [
    { method: "preview", args: [expectedContext, expectedInput] },
    { method: "apply", args: [expectedContext, expectedInput] }
  ]);
  assert.deepEqual(
    audits.map(({ action, outcome, workspaceId: workspace, projectId: project }) => ({
      action,
      outcome,
      workspaceId: workspace,
      projectId: project
    })),
    [
      {
        action: "semantic.cluster_page_mapping.requested",
        outcome: "REQUESTED",
        workspaceId,
        projectId
      },
      {
        action: "semantic.cluster_page_mapping.completed",
        outcome: "PARTIAL",
        workspaceId,
        projectId
      }
    ]
  );
});

function request(): TenantRequest {
  return {
    id: "request-cluster-bulk-001",
    headers: {},
    tenantAuthorization: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "OWNER"
    }
  } as TenantRequest;
}
