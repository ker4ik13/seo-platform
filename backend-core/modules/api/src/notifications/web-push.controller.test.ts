import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { WebPushDeviceSummary } from "@seo-platform/contracts";
import type { AuditRecord } from "../audit/audit.service.js";
import { AuditService } from "../audit/audit.service.js";
import { DomainError } from "../common/domain-error.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest
} from "../identity/identity.types.js";
import { RecentAuthenticationService } from "../identity/recent-authentication.service.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { RealtimeClient } from "../realtime/realtime.client.js";
import { WebPushSubscriptionController } from "./web-push.controller.js";

const userId = "01900000-0000-7000-8000-000000000001";
const sessionFamilyId = "01900000-0000-7000-8000-000000000002";
const installationId = "01900000-0000-7000-8000-000000000003";
const principal: AuthenticatedPrincipal = {
  userId,
  sessionId: "01900000-0000-7000-8000-000000000004",
  sessionFamilyId,
  authenticatedAt: new Date(),
  expiresAt: new Date(Date.now() + 15 * 60_000)
};
const device: WebPushDeviceSummary = {
  installationId,
  label: "Рабочий Mac",
  status: "ACTIVE",
  browser: "CHROME",
  platform: "MACOS",
  applicationServerKeyVersion: 1,
  lastDeliveryStatus: "NEVER",
  createdAt: "2026-07-29T10:00:00.000Z",
  updatedAt: "2026-07-29T10:00:00.000Z",
  version: 1
};
const keyAgreement = createECDH("prime256v1");
keyAgreement.generateKeys();

test("uses user-scoped session guards without a tenant permission boundary", () => {
  const prototype = WebPushSubscriptionController.prototype;
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, prototype.get), [
    SessionAuthGuard
  ]);
  for (const method of [
    prototype.upsert,
    prototype.rename,
    prototype.revoke
  ]) {
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, method), [
      CsrfSessionGuard
    ]);
  }
});

test("injects authenticated session and original user-agent metadata into upsert", async () => {
  let captured: readonly unknown[] | undefined;
  let recentChecks = 0;
  const auditRecords: AuditRecord[] = [];
  const controller = new WebPushSubscriptionController(
    {
      upsertWebPushSubscription: async (...args: unknown[]) => {
        captured = args;
        return device;
      }
    } as unknown as RealtimeClient,
    {
      assert: (candidate: AuthenticatedPrincipal) => {
        assert.equal(candidate.sessionFamilyId, sessionFamilyId);
        recentChecks += 1;
      }
    } as unknown as RecentAuthenticationService,
    auditService(auditRecords)
  );

  const response = await controller.upsert(
    installationId.toUpperCase(),
    browserSubscription(),
    request({
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "Chrome/126.0 Safari/537.36"
    }),
    principal
  );

  assert.equal(recentChecks, 1);
  assert.equal(response.meta.version, 1);
  assert.equal(captured?.[1], installationId);
  assert.deepEqual(captured?.[0], {
    actorId: userId,
    sessionFamilyId,
    requestId: "request-web-push-001"
  });
  assert.deepEqual(captured?.[2], {
    ...browserSubscription(),
    browser: "CHROME",
    platform: "MACOS"
  });
  assert.deepEqual(auditRecords, [
    {
      actorId: userId,
      action: "notification.web_push.enable_requested",
      resourceType: "web_push_subscription",
      resourceId: installationId,
      outcome: "REQUESTED",
      requestId: "request-web-push-001"
    }
  ]);
  assert.equal(
    JSON.stringify(auditRecords).includes("push.example.test"),
    false
  );
});

test("forwards versioned rename and idempotent revoke through trusted context", async () => {
  const calls: Array<{
    readonly method: string;
    readonly arguments: readonly unknown[];
  }> = [];
  const controller = new WebPushSubscriptionController(
    {
      renameWebPushDevice: async (...args: unknown[]) => {
        calls.push({ method: "rename", arguments: args });
        return { ...device, label: "Личный ноутбук", version: 2 };
      },
      revokeWebPushDevice: async (...args: unknown[]) => {
        calls.push({ method: "revoke", arguments: args });
        return {
          installationId,
          status: "REVOKED",
          revoked: false
        } as const;
      }
    } as unknown as RealtimeClient,
    { assert: () => undefined } as unknown as RecentAuthenticationService,
    auditService()
  );

  const renamed = await controller.rename(
    installationId,
    { label: "Личный ноутбук" },
    request({ "if-match": "\"v1\"" }),
    principal
  );
  const revoked = await controller.revoke(
    installationId,
    request({}),
    principal
  );

  assert.equal(renamed.meta.version, 2);
  assert.equal(calls[0]?.arguments[3], 1);
  assert.deepEqual(calls[0]?.arguments[2], {
    label: "Личный ноутбук"
  });
  assert.equal(revoked.data.revoked, false);
  assert.equal(calls[1]?.arguments.length, 2);
});

test("does not dispatch subscription material when recent authentication is stale", async () => {
  let dependencyCalled = false;
  const controller = new WebPushSubscriptionController(
    {
      upsertWebPushSubscription: async () => {
        dependencyCalled = true;
        return device;
      }
    } as unknown as RealtimeClient,
    {
      assert: () => {
        throw new DomainError({
          statusCode: 401,
          code: "REAUTHENTICATION_REQUIRED",
          message: "Recent authentication is required"
        });
      }
    } as unknown as RecentAuthenticationService,
    {
      record: async () => {
        dependencyCalled = true;
      }
    } as unknown as AuditService
  );

  await assert.rejects(
    controller.upsert(
      installationId,
      browserSubscription(),
      request({}),
      principal
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "REAUTHENTICATION_REQUIRED"
  );
  assert.equal(dependencyCalled, false);
});

function browserSubscription() {
  return {
    label: "Рабочий Mac",
    intent: "ENABLE",
    applicationServerKeyVersion: 1,
    subscription: {
      endpoint: "https://push.example.test/subscription/opaque",
      expirationTime: null,
      keys: {
        p256dh: keyAgreement.getPublicKey().toString("base64url"),
        auth: Buffer.alloc(16, 5).toString("base64url")
      }
    }
  };
}

function auditService(records: AuditRecord[] = []): AuditService {
  return {
    record: async (record: AuditRecord) => {
      records.push(record);
    }
  } as unknown as AuditService;
}

function request(
  headers: Readonly<Record<string, string>>
): AuthenticatedRequest {
  return {
    id: "request-web-push-001",
    headers
  } as unknown as AuthenticatedRequest;
}
