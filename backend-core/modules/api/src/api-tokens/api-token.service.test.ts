import assert from "node:assert/strict";
import test from "node:test";
import type { AuditRecord, AuditService } from "../audit/audit.service.js";
import type { AuthorizationService } from "../authorization/authorization.service.js";
import { DomainError } from "../common/domain-error.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { AuthCryptoService } from "../identity/auth-crypto.service.js";
import { ApiTokenService } from "./api-token.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const actorId = "01900000-0000-7000-8000-000000000002";
const tokenId = "01900000-0000-7000-8000-000000000003";

test("lists only non-revoked API tokens owned by the current user", async () => {
  let receivedWhere: unknown;
  const service = serviceWith(
    {
      apiToken: {
        findMany: async (query: { where: unknown }) => {
          receivedWhere = query.where;
          return [storedToken()];
        }
      }
    } as unknown as PrismaService,
    {} as AuditService
  );

  assert.deepEqual(await service.list(workspaceId, actorId), {
    tokens: [
      {
        id: tokenId,
        workspaceId,
        name: "SEO agent",
        prefix: `seo_pat_${"a".repeat(12)}`,
        scopes: ["positions:read"],
        allProjects: true,
        projectIds: [],
        status: "ACTIVE",
        version: 1,
        createdAt: "2026-09-01T12:00:00.000Z",
        updatedAt: "2026-09-01T12:00:00.000Z"
      }
    ]
  });
  assert.deepEqual(receivedWhere, {
    workspaceId,
    createdBy: actorId,
    revokedAt: null
  });
});

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

test("discovers only the current membership and token project intersection", async () => {
  const allowedProjectId = "01900000-0000-7000-8000-000000000010";
  const hiddenProjectId = "01900000-0000-7000-8000-000000000011";
  const service = serviceWith(
    {
      workspaceMember: {
        findUnique: async () => ({
          id: "01900000-0000-7000-8000-000000000012",
          status: "ACTIVE",
          roleCode: "OWNER",
          allProjects: true,
          workspace: {
            id: workspaceId,
            name: "Agency",
            slug: "agency",
            status: "ACTIVE"
          }
        })
      },
      project: {
        findMany: async () => [
          discoveredProject(allowedProjectId, "Allowed"),
          discoveredProject(hiddenProjectId, "Hidden")
        ]
      }
    } as unknown as PrismaService,
    {} as AuditService
  );

  const result = await service.discover(actorId, {
    tokenId,
    workspaceId,
    name: "Semantic agent",
    scopes: ["semantics:read"],
    allProjects: false,
    projectIds: [allowedProjectId]
  });

  assert.deepEqual(result, {
    apiVersion: "v1",
    token: {
      id: tokenId,
      name: "Semantic agent",
      scopes: ["semantics:read"],
      allProjects: false
    },
    workspace: {
      id: workspaceId,
      name: "Agency",
      slug: "agency",
      status: "ACTIVE"
    },
    projects: [
      {
        id: allowedProjectId,
        workspaceId,
        name: "Allowed",
        slug: "allowed",
        domain: "allowed.example",
        status: "ACTIVE"
      }
    ]
  });
});

test("fails discovery closed after membership revocation", async () => {
  let projectReads = 0;
  const service = serviceWith(
    {
      workspaceMember: {
        findUnique: async () => ({
          id: "01900000-0000-7000-8000-000000000012",
          status: "SUSPENDED",
          roleCode: "OWNER",
          allProjects: true,
          workspace: {
            id: workspaceId,
            name: "Agency",
            slug: "agency",
            status: "ACTIVE"
          }
        })
      },
      project: {
        findMany: async () => {
          projectReads += 1;
          return [];
        }
      }
    } as unknown as PrismaService,
    {} as AuditService
  );

  await assert.rejects(
    service.discover(actorId, {
      tokenId,
      workspaceId,
      name: "Agent",
      scopes: ["positions:run"],
      allProjects: true,
      projectIds: []
    }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.statusCode === 404 &&
      error.code === "NOT_FOUND"
  );
  assert.equal(projectReads, 0);
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

function discoveredProject(id: string, name: string) {
  return {
    id,
    workspaceId,
    name,
    slug: name.toLowerCase(),
    domain: `${name.toLowerCase()}.example`,
    status: "ACTIVE" as const,
    memberAccesses: []
  };
}

function silenceLogger(service: ApiTokenService): void {
  (
    service as unknown as {
      logger: { error: (message: string) => void };
    }
  ).logger = { error: () => undefined };
}
