import assert from "node:assert/strict";
import test from "node:test";
import type { AuditRecord, AuditService } from "../audit/audit.service.js";
import type { AuthorizationService } from "../authorization/authorization.service.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { AuthCryptoService } from "../identity/auth-crypto.service.js";
import { ApiTokenService } from "./api-token.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const actorId = "01900000-0000-7000-8000-000000000002";
const tokenId = "01900000-0000-7000-8000-000000000003";

test("returns a newly issued secret when only its success audit is unavailable", async () => {
  const auditActions: string[] = [];
  let createCalls = 0;
  const service = serviceWith(
    {
      apiToken: {
        create: async () => {
          createCalls += 1;
          return storedToken();
        }
      }
    } as unknown as PrismaService,
    {
      record: async (record: AuditRecord) => {
        auditActions.push(record.action);
        if (record.outcome === "SUCCESS") {
          throw new Error("audit temporarily unavailable");
        }
      }
    } as unknown as AuditService
  );
  silenceLogger(service);

  const result = await service.create(
    workspaceId,
    actorId,
    input(),
    { requestId: "api-token-create-test" }
  );

  assert.equal(result.token, `seo_pat_${"a".repeat(43)}`);
  assert.equal(createCalls, 1);
  assert.deepEqual(auditActions, [
    "api_token.create_requested",
    "api_token.created"
  ]);
});

test("does not create a token when the request audit cannot be persisted", async () => {
  const auditError = new Error("audit unavailable");
  let createCalls = 0;
  const service = serviceWith(
    {
      apiToken: {
        create: async () => {
          createCalls += 1;
          return storedToken();
        }
      }
    } as unknown as PrismaService,
    {
      record: async () => {
        throw auditError;
      }
    } as unknown as AuditService
  );

  await assert.rejects(
    service.create(
      workspaceId,
      actorId,
      input(),
      { requestId: "api-token-create-test" }
    ),
    (error: unknown) => error === auditError
  );
  assert.equal(createCalls, 0);
});

test("creates a restricted token without overriding the relation-owned workspace key", async () => {
  let projectAccessInput: unknown;
  const service = serviceWith(
    {
      apiToken: {
        create: async (query: {
          data: { projectAccesses?: unknown };
        }) => {
          projectAccessInput = query.data.projectAccesses;
          return {
            ...storedToken(),
            allProjects: false,
            projectAccesses: [{ projectId: tokenId }]
          };
        }
      }
    } as unknown as PrismaService,
    { record: async () => undefined } as unknown as AuditService,
    {
      forProject: async () => ({ workspaceId })
    } as unknown as AuthorizationService
  );

  await service.create(
    workspaceId,
    actorId,
    {
      ...input(),
      allProjects: false,
      projectIds: [tokenId]
    },
    { requestId: "api-token-restricted-create-test" }
  );

  assert.deepEqual(projectAccessInput, {
    createMany: { data: [{ projectId: tokenId }] }
  });
});

function serviceWith(
  prisma: PrismaService,
  audit: AuditService,
  authorization: AuthorizationService = {} as AuthorizationService
): ApiTokenService {
  return new ApiTokenService(
    prisma,
    {
      randomToken: () => "a".repeat(43),
      hashOpaqueToken: () => "b".repeat(64)
    } as unknown as AuthCryptoService,
    authorization,
    audit
  );
}

function input() {
  return {
    name: "SEO agent",
    scopes: ["positions:read" as const],
    allProjects: true,
    projectIds: [],
    expiresAt: null
  };
}

function storedToken() {
  const now = new Date("2026-09-01T12:00:00.000Z");
  return {
    id: tokenId,
    workspaceId,
    createdBy: actorId,
    name: "SEO agent",
    prefix: `seo_pat_${"a".repeat(12)}`,
    tokenHash: "b".repeat(64),
    previousTokenHash: null,
    previousTokenValidUntil: null,
    scopes: ["positions:read"],
    allProjects: true,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    projectAccesses: []
  };
}

function silenceLogger(service: ApiTokenService): void {
  (
    service as unknown as {
      logger: { error: (message: string) => void };
    }
  ).logger = { error: () => undefined };
}
