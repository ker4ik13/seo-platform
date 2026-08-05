import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException
} from "@nestjs/common";
import {
  realtimeAuthorizationLeaseMilliseconds,
  realtimeTicketRequestSchemaVersion,
  realtimeTicketTtlMilliseconds,
  type InternalIssueRealtimeProjectTicketInput
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { InternalProjectContext } from "../internal/internal-context.js";
import {
  type RealtimeAuthorization,
  RealtimeTicketService
} from "./realtime-ticket.service.js";

const NOW = new Date("2026-07-30T12:00:00.000Z");
const ORIGIN = "https://app.example.test";
const OTHER_ORIGIN = "https://other.example.test";
const CONNECTION_ID = "socket_connection_01";
const TICKET = randomBytes(32).toString("base64url");

test("issues a hash-only ticket with exact bounded lifetimes", async () => {
  let created: Readonly<Record<string, unknown>> | undefined;
  const transaction = {
    $queryRaw: queryRawAt(NOW),
    revokedSessionFamilyTombstone: {
      findUnique: async () => null
    },
    realtimeProjectTicket: {
      deleteMany: async () => ({ count: 0 }),
      count: async () => 0,
      updateMany: async () => ({ count: 0 }),
      create: async (args: {
        readonly data: Readonly<Record<string, unknown>>;
      }) => {
        created = args.data;
        return args.data;
      }
    }
  };

  const result = await service(transaction).issue(context(), command());

  assert.ok(created);
  assert.equal("ticket" in created, false);
  assert.equal(
    Buffer.from(created.ticketHash as Uint8Array).toString("hex"),
    sha256(result.ticket)
  );
  assert.equal(
    Buffer.from(created.originHash as Uint8Array).toString("hex"),
    sha256(ORIGIN)
  );
  assert.equal(created.userId, command().userId);
  assert.equal(created.sessionFamilyId, command().sessionFamilyId);
  assert.equal(created.membershipVersion, command().membershipVersion);
  assert.equal(result.issuedAt, NOW.toISOString());
  assert.equal(
    Date.parse(result.expiresAt) - Date.parse(result.issuedAt),
    realtimeTicketTtlMilliseconds
  );
  assert.equal(
    Date.parse(result.authorizationExpiresAt) -
      Date.parse(result.issuedAt),
    realtimeAuthorizationLeaseMilliseconds
  );
});

test("rejects owner scope mismatches before persisting a ticket", async () => {
  let transactionStarted = false;
  const prisma = {
    $transaction: async () => {
      transactionStarted = true;
    }
  } as unknown as PrismaService;
  const tickets = new RealtimeTicketService(prisma, config());

  await assert.rejects(
    tickets.issue(
      { ...context(), projectId: context().workspaceId },
      command()
    ),
    ForbiddenException
  );
  assert.equal(transactionStarted, false);
});

test("binds atomic one-time consumption to the browser origin", async () => {
  let consumed = false;
  let consumeWhere: Readonly<Record<string, unknown>> | undefined;
  const authorization = authorizationRow();
  const transaction = {
    $queryRaw: queryRawAt(NOW),
    revokedSessionFamilyTombstone: {
      findUnique: async () => null
    },
    realtimeProjectTicket: {
      findUnique: async (args: {
        readonly select: Readonly<Record<string, boolean>>;
      }) => {
        if ("workspaceId" in args.select) return authorization;
        if ("sessionFamilyId" in args.select) {
          return {
            userId: authorization.userId,
            sessionFamilyId: authorization.sessionFamilyId
          };
        }
        return {
          id: authorization.id,
          userId: authorization.userId,
          clientInstanceId: authorization.clientInstanceId
        };
      },
      count: async () => 0,
      updateMany: async (args: {
        readonly where: Readonly<Record<string, unknown>>;
      }) => {
        consumeWhere = args.where;
        const suppliedOriginHash = Buffer.from(
          args.where.originHash as Uint8Array
        ).toString("hex");
        if (consumed || suppliedOriginHash !== sha256(ORIGIN)) {
          return { count: 0 };
        }
        consumed = true;
        return { count: 1 };
      }
    }
  };
  const tickets = service(transaction);

  await assert.rejects(
    tickets.consume(TICKET, OTHER_ORIGIN, CONNECTION_ID),
    UnauthorizedException
  );
  const result = await tickets.consume(TICKET, ORIGIN, CONNECTION_ID);
  await assert.rejects(
    tickets.consume(TICKET, ORIGIN, CONNECTION_ID),
    UnauthorizedException
  );

  assert.equal(result.ticketId, authorization.id);
  assert.equal(result.projectId, command().projectId);
  assert.equal(result.membershipVersion, command().membershipVersion);
  assert.ok(consumeWhere);
  assert.equal(consumeWhere.connectionId, undefined);
  assert.equal(consumeWhere.consumedAt, null);
  assert.equal(consumeWhere.invalidatedAt, null);
});

test("fails closed when the session family tombstone exists", async () => {
  const transaction = {
    $queryRaw: queryRawAt(NOW),
    revokedSessionFamilyTombstone: {
      findUnique: async () => ({ userId: command().userId })
    },
    realtimeProjectTicket: {
      deleteMany: async () => ({ count: 0 }),
      count: async () => 1,
      updateMany: async () => ({ count: 0 }),
      create: async () => {
        throw new Error("must not persist a revoked authorization");
      }
    }
  };
  const tickets = service(transaction);

  await assert.rejects(
    tickets.issue(context(), command()),
    UnauthorizedException
  );
  await assert.rejects(
    tickets.assertActive(authorization(), CONNECTION_ID),
    UnauthorizedException
  );
});

test("enforces the per-user active connection ceiling", async () => {
  const row = authorizationRow();
  const transaction = {
    $queryRaw: queryRawAt(NOW),
    revokedSessionFamilyTombstone: {
      findUnique: async () => null
    },
    realtimeProjectTicket: {
      findUnique: async (args: {
        readonly select: Readonly<Record<string, boolean>>;
      }) =>
        "sessionFamilyId" in args.select
          ? {
              userId: row.userId,
              sessionFamilyId: row.sessionFamilyId
            }
          : {
              id: row.id,
              userId: row.userId,
              clientInstanceId: row.clientInstanceId
            },
      count: async () => 5,
      updateMany: async () => {
        throw new Error("must not consume above the connection limit");
      }
    }
  };

  await assert.rejects(
    service(transaction).consume(TICKET, ORIGIN, CONNECTION_ID),
    (error: unknown) =>
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
  );
});

function service(transaction: object): RealtimeTicketService {
  const prisma = {
    $transaction: async (
      callback: (value: object) => Promise<unknown>
    ): Promise<unknown> => callback(transaction)
  } as unknown as PrismaService;
  return new RealtimeTicketService(prisma, config());
}

function config(): AppConfig {
  return {
    webOrigins: [ORIGIN, OTHER_ORIGIN]
  } as unknown as AppConfig;
}

function queryRawAt(now: Date) {
  return async (strings: TemplateStringsArray): Promise<readonly unknown[]> =>
    strings.join("").includes("clock_timestamp")
      ? [{ now }]
      : [];
}

function context(): InternalProjectContext {
  return {
    actorId: "0198f258-8cc7-7abc-8def-1234567890ab",
    workspaceId: "0198f258-8cc7-7abc-8def-1234567890ae",
    projectId: "0198f258-8cc7-7abc-8def-1234567890af",
    membershipId: "0198f258-8cc7-7abc-8def-1234567890b0",
    membershipVersion: 4
  };
}

function command(): InternalIssueRealtimeProjectTicketInput {
  return {
    schemaVersion: realtimeTicketRequestSchemaVersion,
    userId: context().actorId,
    sessionId: "0198f258-8cc7-7abc-8def-1234567890ac",
    sessionFamilyId: "0198f258-8cc7-7abc-8def-1234567890ad",
    sessionExpiresAt: "2026-08-30T12:00:00.000Z",
    workspaceId: context().workspaceId,
    projectId: context().projectId,
    membershipId: context().membershipId,
    membershipVersion: context().membershipVersion,
    clientInstanceId: "0198f258-8cc7-7abc-8def-1234567890b1",
    origin: ORIGIN
  };
}

function authorizationRow() {
  return {
    id: "0198f258-8cc7-7abc-8def-1234567890b2",
    userId: command().userId,
    sessionId: command().sessionId,
    sessionFamilyId: command().sessionFamilyId,
    workspaceId: command().workspaceId,
    projectId: command().projectId,
    membershipId: command().membershipId,
    membershipVersion: command().membershipVersion,
    clientInstanceId: command().clientInstanceId,
    authorizationExpiresAt: new Date(
      NOW.getTime() + realtimeAuthorizationLeaseMilliseconds
    )
  };
}

function authorization(): RealtimeAuthorization {
  return {
    ticketId: authorizationRow().id,
    userId: command().userId,
    sessionId: command().sessionId,
    sessionFamilyId: command().sessionFamilyId,
    workspaceId: command().workspaceId,
    projectId: command().projectId,
    membershipId: command().membershipId,
    membershipVersion: command().membershipVersion,
    clientInstanceId: command().clientInstanceId,
    authorizationExpiresAt: authorizationRow().authorizationExpiresAt
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
