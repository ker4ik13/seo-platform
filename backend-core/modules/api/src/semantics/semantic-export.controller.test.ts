import assert from "node:assert/strict";
import test from "node:test";
import {
  GUARDS_METADATA,
  PATH_METADATA
} from "@nestjs/common/constants.js";
import type { FastifyReply } from "fastify";
import type { AuditRecord } from "../audit/audit.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { SemanticExportController } from "./semantic-export.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const exportId = "01900000-0000-7000-8000-000000000004";
const signedUrl =
  "https://storage.example.test/artifacts/semantic-core.xlsx?signature=short-lived";
const principal: AuthenticatedPrincipal = {
  userId: actorId,
  sessionId: "01900000-0000-7000-8000-000000000005",
  sessionFamilyId: "01900000-0000-7000-8000-000000000006",
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 900_000)
};

test("protects the user-initiated export file stream", () => {
  const method = SemanticExportController.prototype.file;
  assert.equal(Reflect.getMetadata(PATH_METADATA, method), ":exportId/file");
  assert.equal(
    Reflect.getMetadata(REQUIRED_PERMISSION, method),
    "semantic.export"
  );
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
    SessionAuthGuard,
    TenantPermissionGuard
  ]);
});

test("streams an authorized export through the application boundary", async () => {
  const originalFetch = globalThis.fetch;
  const file = Uint8Array.from([80, 75, 3, 4]);
  const calls: unknown[][] = [];
  const audits: AuditRecord[] = [];
  const headers = new Map<string, string>();
  let statusCode: number | undefined;
  let sentBody: unknown;
  const reply = {
    header(name: string, value: string) {
      headers.set(name.toLocaleLowerCase("en-US"), value);
      return this;
    },
    code(value: number) {
      statusCode = value;
      return this;
    },
    send(value: unknown) {
      sentBody = value;
      return this;
    }
  } as unknown as FastifyReply;
  const controller = new SemanticExportController(
    {
      downloadSemanticExport: async (...args: unknown[]) => {
        calls.push(args);
        return {
          url: signedUrl,
          filename: "semantic-core.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          rowCount: 2_002,
          sizeBytes: String(file.byteLength)
        };
      }
    } as unknown as JobsClient,
    {} as BillingEntitlementService,
    {
      record: async (record: AuditRecord) => {
        audits.push(record);
      }
    } as unknown as AuditService
  );

  let fetchedUrl: string | undefined;
  globalThis.fetch = async (input) => {
    fetchedUrl = input instanceof URL
      ? input.toString()
      : typeof input === "string"
        ? input
        : input.url;
    return new Response(file, { status: 200 });
  };

  try {
    await controller.file(exportId, request(), reply, principal);

    assert.equal(fetchedUrl, signedUrl);
    assert.equal(statusCode, 200);
    assert.equal(headers.get("location"), undefined);
    assert.equal(headers.get("cache-control"), "private, no-store");
    assert.equal(headers.get("content-length"), "4");
    assert.equal(
      headers.get("content-disposition"),
      "attachment; filename*=UTF-8''semantic-core.xlsx"
    );
    assert.equal(
      headers.get("content-type"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    assert.ok(sentBody && typeof sentBody === "object");
    const chunks: Uint8Array[] = [];
    for await (const chunk of sentBody as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(file));
    assert.deepEqual(calls, [[
      {
        tenant: {
          workspaceId,
          workspaceStatus: "ACTIVE",
          projectId,
          projectStatus: "ACTIVE",
          roleCode: "OWNER"
        },
        actorId,
        requestId: "request-semantic-export-001"
      },
      exportId
    ]]);
    assert.deepEqual(
      audits.map(({ action, outcome, resourceId }) => ({
        action,
        outcome,
        resourceId
      })),
      [{
        action: "semantic.export.download_url_issued",
        outcome: "SUCCESS",
        resourceId: exportId
      }]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function request(): TenantRequest {
  return {
    id: "request-semantic-export-001",
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
