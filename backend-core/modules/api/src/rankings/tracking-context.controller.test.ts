import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  MODULE_METADATA
} from "@nestjs/common/constants.js";
import type { TrackingContextSummary } from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import type { AuditRecord } from "../audit/audit.service.js";
import { AuditService } from "../audit/audit.service.js";
import type {
  AuthorizedProjectStatus,
  AuthorizedWorkspaceStatus,
  TenantRequest
} from "../authorization/authorization.types.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { DomainError } from "../common/domain-error.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { TenantModule } from "../tenants/tenant.module.js";
import { RankingModule } from "./ranking.module.js";
import { TrackingContextController } from "./tracking-context.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const contextId = "01900000-0000-7000-8000-000000000004";
const keywordId = "01900000-0000-7000-8000-000000000005";
const assignmentId = "01900000-0000-7000-8000-000000000006";
const entitlement = {
  planCode: "TEAM",
  planVersion: 1,
  storedKeywords: 2_000_000,
  keywordsPerProject: 2_000_000,
  trackedContextPairs: 50_000
} as const;
const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000007",
  sessionFamilyId: "01900000-0000-7000-8000-000000000008",
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 900_000)
};
const summary: TrackingContextSummary = {
  id: contextId,
  workspaceId,
  projectId,
  name: "Google · Москва · desktop",
  status: "ACTIVE",
  configuration: {
    searchEngine: "GOOGLE",
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP",
    depth: 30,
    domainMatchRule: { mode: "INCLUDE_WWW" },
    safeSearch: false,
    configurationVersion: 1,
    createdBy: actorId,
    createdAt: "2026-07-29T10:00:00.000Z"
  },
  assignedKeywordCount: 0,
  version: 1,
  createdBy: actorId,
  updatedBy: actorId,
  createdAt: "2026-07-29T10:00:00.000Z",
  updatedAt: "2026-07-29T10:00:00.000Z"
};
const command = {
  name: summary.name,
  configuration: {
    searchEngine: "GOOGLE",
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP",
    depth: 30,
    domainMatchRule: { mode: "INCLUDE_WWW" },
    safeSearch: false
  }
} as const;

test("declares ranking read and configure permission boundaries", () => {
  const prototype = TrackingContextController.prototype;
  for (const method of [
    prototype.list,
    prototype.get,
    prototype.listKeywords
  ]) {
    assert.equal(
      Reflect.getMetadata(REQUIRED_PERMISSION, method),
      "ranking.view"
    );
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
      SessionAuthGuard,
      TenantPermissionGuard
    ]);
  }
  for (const method of [
    prototype.create,
    prototype.update,
    prototype.archive,
    prototype.restore,
    prototype.replaceKeywords,
    prototype.assignKeyword,
    prototype.removeKeyword
  ]) {
    assert.equal(
      Reflect.getMetadata(REQUIRED_PERMISSION, method),
      "ranking.configure"
    );
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
      CsrfSessionGuard,
      TenantPermissionGuard
    ]);
  }
  assert.equal(
    Reflect.getMetadata(HTTP_CODE_METADATA, prototype.create),
    201
  );
  assert.equal(
    Reflect.getMetadata(HTTP_CODE_METADATA, prototype.archive),
    200
  );
  assert.equal(
    Reflect.getMetadata(HTTP_CODE_METADATA, prototype.restore),
    200
  );
});

test("imports every module required by ranking controller guards and clients", () => {
  assert.deepEqual(
    Reflect.getMetadata(MODULE_METADATA.IMPORTS, RankingModule),
    [
      AuthorizationModule,
      BillingModule,
      IdentityModule,
      JobsModule,
      SeoDataModule,
      TenantModule
    ]
  );
});

test("projects effective configure access without hiding readable history", async () => {
  const controller = controllerWith({
    listTrackingContexts: async () => ({
      contexts: [summary],
      contextsTruncated: false
    })
  });
  const cases = [
    {
      request: tenantRequest(),
      restriction: "NONE",
      canConfigure: true
    },
    {
      request: tenantRequest({ workspaceStatus: "READ_ONLY" }),
      restriction: "WORKSPACE_READ_ONLY",
      canConfigure: false
    },
    {
      request: tenantRequest({ projectStatus: "ARCHIVED" }),
      restriction: "PROJECT_ARCHIVED",
      canConfigure: false
    },
    {
      request: tenantRequest({ roleCode: "ANALYST" }),
      restriction: "MISSING_PERMISSION",
      canConfigure: false
    }
  ] as const;

  for (const candidate of cases) {
    const response = await controller.list(
      candidate.request,
      principal
    );
    assert.equal(
      response.data.access.mutationRestriction,
      candidate.restriction
    );
    assert.equal(
      response.data.access.canConfigure,
      candidate.canConfigure
    );
    assert.equal(response.data.contexts[0]?.id, contextId);
  }
});

test("creates, updates and changes status with trusted scope, CAS and audit", async () => {
  const calls: Array<{
    readonly method: string;
    readonly args: readonly unknown[];
  }> = [];
  const records: AuditRecord[] = [];
  const controller = controllerWith(
    {
      createTrackingContext: async (...args: unknown[]) => {
        calls.push({ method: "create", args });
        return summary;
      },
      updateTrackingContext: async (...args: unknown[]) => {
        calls.push({ method: "update", args });
        return { ...summary, version: 2 };
      },
      changeTrackingContextStatus: async (...args: unknown[]) => {
        calls.push({ method: "status", args });
        return { ...summary, version: 2 };
      }
    },
    records
  );
  const createReply = reply();
  const updateReply = reply();
  const archiveReply = reply();

  const created = await controller.create(
    command,
    tenantRequest({
      headers: {
        "idempotency-key": "tracking-context-create-001"
      }
    }),
    createReply.value,
    principal
  );
  const updated = await controller.update(
    contextId.toUpperCase(),
    command,
    tenantRequest({ headers: { "if-match": "\"v1\"" } }),
    updateReply.value,
    principal
  );
  const archived = await controller.archive(
    contextId,
    tenantRequest({ headers: { "if-match": "W/\"v1\"" } }),
    archiveReply.value,
    principal
  );

  assert.equal(created.meta.version, 1);
  assert.equal(updated.meta.version, 2);
  assert.equal(archived.meta.version, 2);
  assert.equal(createReply.headers.get("etag"), "\"v1\"");
  assert.equal(updateReply.headers.get("etag"), "\"v2\"");
  assert.equal(archiveReply.headers.get("etag"), "\"v2\"");
  assert.equal(calls[0]?.args[2], "tracking-context-create-001");
  assert.equal(calls[1]?.args[1], contextId);
  assert.equal(calls[1]?.args[3], 1);
  assert.equal(calls[2]?.args[2], "archive");
  assert.equal(calls[2]?.args[3], 1);
  assert.deepEqual(calls[0]?.args[0], {
    tenant: {
      workspaceId,
      workspaceStatus: "ACTIVE",
      projectId,
      projectStatus: "ACTIVE",
      roleCode: "OWNER"
    },
    actorId,
    requestId: "request-tracking-context-001"
  });
  assert.deepEqual(
    records.map(({ action, outcome }) => [action, outcome]),
    [
      [
        "ranking.tracking_context.create_requested",
        "REQUESTED"
      ],
      ["ranking.tracking_context.created", "SUCCESS"],
      [
        "ranking.tracking_context.update_requested",
        "REQUESTED"
      ],
      ["ranking.tracking_context.updated", "SUCCESS"],
      [
        "ranking.tracking_context.archive_requested",
        "REQUESTED"
      ],
      ["ranking.tracking_context.archived", "SUCCESS"]
    ]
  );
});

test("lists and changes point keyword assignments without bulk ambiguity", async () => {
  const calls: Array<{
    readonly method: string;
    readonly args: readonly unknown[];
  }> = [];
  const records: AuditRecord[] = [];
  const controller = controllerWith(
    {
      listTrackingContextKeywords: async (...args: unknown[]) => {
        calls.push({ method: "list", args });
        return {
          data: [
            {
              assignmentId,
              contextId,
              keywordId,
              keywordVersion: 7,
              textOriginal: "SEO аудит",
              language: "ru",
              isTracked: false,
              assignedBy: actorId,
              assignedAt: "2026-07-29T10:05:00.000Z"
            }
          ],
          page: { hasNext: false, totalApprox: 1 }
        };
      },
      changeTrackingContextKeyword: async (...args: unknown[]) => {
        calls.push({ method: "change", args });
        const assigned = args[3] === true;
        return {
          contextId,
          keywordId,
          assigned,
          ...(assigned ? { assignmentId } : {}),
          changedAt: "2026-07-29T10:05:00.000Z"
        };
      }
    },
    records
  );

  const page = await controller.listKeywords(
    contextId,
    { limit: "25", search: "SEO" },
    tenantRequest(),
    principal
  );
  const assigned = await controller.assignKeyword(
    contextId,
    keywordId,
    tenantRequest(),
    principal
  );
  const removed = await controller.removeKeyword(
    contextId,
    keywordId,
    tenantRequest(),
    principal
  );

  assert.equal(page.data[0]?.keywordId, keywordId);
  assert.deepEqual(calls[0]?.args[2], {
    limit: 25,
    search: "SEO"
  });
  assert.equal(assigned.data.assigned, true);
  assert.equal(removed.data.assigned, false);
  assert.deepEqual(calls[1]?.args[4], entitlement);
  assert.deepEqual(calls[2]?.args[4], entitlement);
  assert.deepEqual(
    records.map(({ action, resourceId }) => [action, resourceId]),
    [
      [
        "ranking.tracking_context.keyword_assign_requested",
        keywordId
      ],
      [
        "ranking.tracking_context.keyword_assigned",
        keywordId
      ],
      [
        "ranking.tracking_context.keyword_remove_requested",
        keywordId
      ],
      ["ranking.tracking_context.keyword_removed", keywordId]
    ]
  );
});

test("atomically replaces keyword assignments with CAS, idempotency and one audit pair", async () => {
  const calls: readonly unknown[][] = [];
  const mutableCalls = calls as unknown[][];
  const records: AuditRecord[] = [];
  const controller = controllerWith(
    {
      replaceTrackingContextKeywords: async (...args: unknown[]) => {
        mutableCalls.push(args);
        return {
          contextId,
          assignedKeywordCount: 1,
          addedKeywordCount: 1,
          removedKeywordCount: 0,
          unchangedKeywordCount: 0,
          keywordSetHash: {
            algorithm: "SHA_256",
            value: "a".repeat(64)
          },
          version: 2,
          changedAt: "2026-07-29T10:05:00.000Z"
        };
      }
    },
    records
  );
  const response = reply();

  const result = await controller.replaceKeywords(
    contextId,
    { keywordIds: [keywordId] },
    tenantRequest({
      headers: {
        "if-match": "\"v1\"",
        "idempotency-key": "replace-keywords-001"
      }
    }),
    response.value,
    principal
  );

  assert.equal(result.data.assignedKeywordCount, 1);
  assert.equal(result.meta.version, 2);
  assert.equal(response.headers.get("etag"), "\"v2\"");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[1], contextId);
  assert.deepEqual(calls[0]?.[2], { keywordIds: [keywordId] });
  assert.equal(calls[0]?.[3], 1);
  assert.equal(calls[0]?.[4], "replace-keywords-001");
  assert.deepEqual(calls[0]?.[5], entitlement);
  assert.deepEqual(
    records.map(({ action, resourceId }) => [action, resourceId]),
    [
      [
        "ranking.tracking_context.keywords_replace_requested",
        contextId
      ],
      ["ranking.tracking_context.keywords_replaced", contextId]
    ]
  );
});

test("keeps intent audit fail-closed and post-commit audit best-effort", async () => {
  let dependencyCalls = 0;
  const failClosed = new TrackingContextController(
    {
      createTrackingContext: async () => {
        dependencyCalls += 1;
        return summary;
      }
    } as unknown as SeoDataClient,
    {
      record: async () => {
        throw new Error("audit unavailable");
      }
    } as unknown as AuditService,
    billingEntitlements()
  );
  await assert.rejects(
    failClosed.create(
      command,
      tenantRequest({
        headers: {
          "idempotency-key": "tracking-context-create-001"
        }
      }),
      reply().value,
      principal
    ),
    /audit unavailable/
  );
  assert.equal(dependencyCalls, 0);

  let auditCalls = 0;
  const committed = new TrackingContextController(
    {
      createTrackingContext: async () => {
        dependencyCalls += 1;
        return summary;
      }
    } as unknown as SeoDataClient,
    {
      record: async () => {
        auditCalls += 1;
        if (auditCalls === 2) throw new Error("audit unavailable");
      }
    } as unknown as AuditService,
    billingEntitlements()
  );
  silenceControllerLogger(committed);
  const response = reply();
  const result = await committed.create(
    command,
    tenantRequest({
      headers: {
        "idempotency-key": "tracking-context-create-001"
      }
    }),
    response.value,
    principal
  );

  assert.equal(result.data.id, contextId);
  assert.equal(response.headers.get("etag"), "\"v1\"");
  assert.equal(dependencyCalls, 1);
  assert.equal(auditCalls, 2);
});

test("rejects archived project mutations and missing preconditions before side effects", async () => {
  let dependencyCalled = false;
  const controller = new TrackingContextController(
    {
      createTrackingContext: async () => {
        dependencyCalled = true;
        return summary;
      },
      updateTrackingContext: async () => {
        dependencyCalled = true;
        return summary;
      }
    } as unknown as SeoDataClient,
    {
      record: async () => {
        dependencyCalled = true;
      }
    } as unknown as AuditService,
    billingEntitlements()
  );

  await assert.rejects(
    controller.create(
      command,
      tenantRequest({
        projectStatus: "ARCHIVED",
        headers: {}
      }),
      reply().value,
      principal
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "RESOURCE_STATE_CONFLICT"
  );
  await assert.rejects(
    controller.create(
      command,
      tenantRequest({ headers: {} }),
      reply().value,
      principal
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "VALIDATION_FAILED"
  );
  await assert.rejects(
    controller.update(
      contextId,
      command,
      tenantRequest({ headers: {} }),
      reply().value,
      principal
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.statusCode === 428 &&
      error.code === "VERSION_CONFLICT"
  );
  assert.equal(dependencyCalled, false);
});

function controllerWith(
  seoData: Partial<SeoDataClient>,
  records: AuditRecord[] = []
): TrackingContextController {
  return new TrackingContextController(
    seoData as SeoDataClient,
    {
      record: async (record: AuditRecord) => {
        records.push(record);
      }
    } as unknown as AuditService,
    billingEntitlements()
  );
}

function billingEntitlements(): BillingEntitlementService {
  return {
    semanticCapacity: async () => entitlement
  } as unknown as BillingEntitlementService;
}

function tenantRequest(
  options: Readonly<{
    workspaceStatus?: AuthorizedWorkspaceStatus;
    projectStatus?: AuthorizedProjectStatus;
    roleCode?: string;
    headers?: Readonly<Record<string, string>>;
  }> = {}
): TenantRequest {
  return {
    id: "request-tracking-context-001",
    headers: options.headers ?? {},
    tenantAuthorization: {
      workspaceId,
      workspaceStatus: options.workspaceStatus ?? "ACTIVE",
      projectId,
      projectStatus: options.projectStatus ?? "ACTIVE",
      roleCode: options.roleCode ?? "OWNER"
    }
  } as unknown as TenantRequest;
}

function reply(): {
  readonly value: FastifyReply;
  readonly headers: Map<string, string>;
} {
  const responseHeaders = new Map<string, string>();
  return {
    value: {
      header: (name: string, value: string) => {
        responseHeaders.set(name.toLowerCase(), value);
      }
    } as unknown as FastifyReply,
    headers: responseHeaders
  };
}

function silenceControllerLogger(
  controller: TrackingContextController
): void {
  (
    controller as unknown as {
      logger: { error: (message: string) => void };
    }
  ).logger = { error: () => undefined };
}
