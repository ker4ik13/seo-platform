import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProjectMemberAccess,
  User,
  WorkspaceInvite,
  WorkspaceMember
} from "../generated/prisma/client.js";
import type { AuditService } from "../audit/audit.service.js";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import { AuthCryptoService } from "../identity/auth-crypto.service.js";
import type { OutboxService } from "../outbox/outbox.service.js";
import { TeamService } from "./team.service.js";

const WORKSPACE_ID = "01900000-0000-7000-8000-000000000001";
const OTHER_WORKSPACE_ID = "01900000-0000-7000-8000-000000000002";
const CONFIG = loadAppConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test",
  AUTH_PASSWORD_PEPPER: "test-only-team-service-pepper"
});

test("paginates workspace members with an opaque tenant-bound keyset", async () => {
  const newest = member(
    "01900000-0000-7000-8000-000000000030",
    "new@example.com"
  );
  const older = member(
    "01900000-0000-7000-8000-000000000020",
    "old@example.com"
  );
  const calls: Array<Readonly<Record<string, unknown>>> = [];
  const prisma = {
    workspaceMember: {
      findMany: async (input: Readonly<Record<string, unknown>>) => {
        calls.push(input);
        return calls.length === 1 ? [newest, older] : [older];
      }
    }
  } as unknown as PrismaService;
  const service = teamService(prisma);

  const first = await service.listMembers(WORKSPACE_ID, { limit: 1 });
  assert.deepEqual(first.data.map(({ id }) => id), [newest.id]);
  assert.equal(first.page.hasNext, true);
  assert.ok(first.page.nextCursor);

  const second = await service.listMembers(WORKSPACE_ID, {
    limit: 1,
    cursor: first.page.nextCursor
  });
  assert.deepEqual(second.data.map(({ id }) => id), [older.id]);
  assert.deepEqual(second.page, { hasNext: false });
  assert.equal(calls[0]?.take, 2);
  assert.deepEqual(calls[0]?.orderBy, { id: "desc" });
  assert.deepEqual(
    (calls[1]?.where as Readonly<Record<string, unknown>> | undefined)?.id,
    { lt: newest.id }
  );

  await assert.rejects(
    service.listMembers(OTHER_WORKSPACE_ID, {
      limit: 1,
      cursor: first.page.nextCursor
    }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.fieldErrors?.[0]?.code === "INVALID_CURSOR"
  );
  assert.equal(calls.length, 2);
});

test("lists only active unexpired pending invitations with a bounded page", async () => {
  const newest = invite(
    "01900000-0000-7000-8000-000000000050",
    "new@example.com"
  );
  const older = invite(
    "01900000-0000-7000-8000-000000000040",
    "old@example.com"
  );
  const findCalls: Array<Readonly<Record<string, unknown>>> = [];
  const expireCalls: Array<Readonly<Record<string, unknown>>> = [];
  const prisma = {
    workspaceInvite: {
      updateMany: async (input: Readonly<Record<string, unknown>>) => {
        expireCalls.push(input);
        return { count: 0 };
      },
      findMany: async (input: Readonly<Record<string, unknown>>) => {
        findCalls.push(input);
        return [newest, older];
      }
    }
  } as unknown as PrismaService;
  const service = teamService(prisma);

  const result = await service.listInvites(WORKSPACE_ID, {
    limit: 1,
    status: "PENDING"
  });
  assert.deepEqual(result.data.map(({ id }) => id), [newest.id]);
  assert.equal(result.page.hasNext, true);
  assert.ok(result.page.nextCursor);
  assert.equal(expireCalls.length, 1);
  assert.equal(findCalls[0]?.take, 2);
  assert.deepEqual(findCalls[0]?.orderBy, { id: "desc" });
  const where = findCalls[0]?.where as
    | Readonly<Record<string, unknown>>
    | undefined;
  assert.deepEqual(where?.status, { in: ["SENT", "DELIVERED"] });
  assert.ok(
    (where?.expiresAt as { readonly gt?: unknown } | undefined)?.gt instanceof
      Date
  );
});

function teamService(prisma: PrismaService): TeamService {
  return new TeamService(
    prisma,
    {} as AuditService,
    {} as OutboxService,
    new AuthCryptoService(CONFIG),
    CONFIG
  );
}

function member(
  id: string,
  email: string
): WorkspaceMember & {
  readonly user: User;
  readonly projectAccesses: readonly ProjectMemberAccess[];
} {
  const now = new Date("2026-07-30T12:00:00.000Z");
  return {
    id,
    workspaceId: WORKSPACE_ID,
    userId: id,
    roleCode: "ADMIN",
    allProjects: true,
    status: "ACTIVE",
    invitedBy: null,
    version: 1,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    user: {
      id,
      emailNormalized: email,
      emailDisplay: email,
      emailVerifiedAt: now,
      passwordHash: null,
      displayName: email,
      locale: "ru",
      timezone: "Europe/Moscow",
      country: null,
      status: "ACTIVE",
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    },
    projectAccesses: []
  };
}

function invite(id: string, email: string): WorkspaceInvite {
  const now = new Date("2026-07-30T12:00:00.000Z");
  return {
    id,
    workspaceId: WORKSPACE_ID,
    emailNormalized: email,
    emailDisplay: email,
    roleCode: "VIEWER",
    allProjects: true,
    projectAccesses: [],
    message: null,
    tokenHash: id.replaceAll("-", "").padEnd(64, "0"),
    status: "SENT",
    invitedBy: id,
    expiresAt: new Date("2026-08-06T12:00:00.000Z"),
    acceptedAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now
  };
}
