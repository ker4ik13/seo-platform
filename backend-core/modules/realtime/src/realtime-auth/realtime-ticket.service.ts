import { createHash, randomBytes } from "node:crypto";
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import {
  isRealtimeOpaqueTicket,
  realtimeAuthorizationLeaseMilliseconds,
  realtimeCollaborationNamespace,
  realtimeTicketTtlMilliseconds,
  type InternalIssueRealtimeProjectTicketInput,
  type RealtimeProjectTicket
} from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { InternalProjectContext } from "../internal/internal-context.js";
import { acquireWebPushUserLock } from "../notifications/web-push-user-lock.js";

const MAX_ACTIVE_CONNECTIONS_PER_USER = 5;
const MAX_TICKETS_PER_USER_PER_MINUTE = 30;
const TICKET_RETENTION_MILLISECONDS = 60 * 60_000;
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export interface RealtimeAuthorization {
  readonly ticketId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly sessionFamilyId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly membershipId: string;
  readonly membershipVersion: number;
  readonly clientInstanceId: string;
  readonly authorizationExpiresAt: Date;
}

@Injectable()
export class RealtimeTicketService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async issue(
    context: InternalProjectContext,
    input: InternalIssueRealtimeProjectTicketInput
  ): Promise<RealtimeProjectTicket> {
    assertTrustedContext(context, input);
    this.assertAllowedOrigin(input.origin);

    const ticket = randomBytes(32).toString("base64url");
    const ticketHash = digest(ticket);
    const originHash = digest(input.origin);
    const sessionExpiresAt = new Date(input.sessionExpiresAt);

    return this.prisma.$transaction(async (transaction) => {
      await acquireWebPushUserLock(transaction, input.userId);
      const now = await databaseNow(transaction);
      const authorizationExpiresAt = new Date(
        now.getTime() + realtimeAuthorizationLeaseMilliseconds
      );
      if (sessionExpiresAt < authorizationExpiresAt) {
        throw unauthorized();
      }
      await this.assertFamilyActive(
        transaction,
        input.userId,
        input.sessionFamilyId
      );

      await transaction.realtimeProjectTicket.deleteMany({
        where: {
          userId: input.userId,
          authorizationExpiresAt: {
            lt: new Date(now.getTime() - TICKET_RETENTION_MILLISECONDS)
          }
        }
      });
      const recentTicketCount =
        await transaction.realtimeProjectTicket.count({
          where: {
            userId: input.userId,
            issuedAt: { gt: new Date(now.getTime() - 60_000) }
          }
        });
      if (recentTicketCount >= MAX_TICKETS_PER_USER_PER_MINUTE) {
        throw rateLimited("Realtime ticket issuance limit reached");
      }

      await transaction.realtimeProjectTicket.updateMany({
        where: {
          userId: input.userId,
          sessionId: input.sessionId,
          projectId: input.projectId,
          clientInstanceId: input.clientInstanceId,
          consumedAt: null,
          invalidatedAt: null
        },
        data: { invalidatedAt: now }
      });

      const expiresAt = new Date(
        now.getTime() + realtimeTicketTtlMilliseconds
      );
      await transaction.realtimeProjectTicket.create({
        data: {
          ticketHash,
          originHash,
          userId: input.userId,
          sessionId: input.sessionId,
          sessionFamilyId: input.sessionFamilyId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          membershipId: input.membershipId,
          membershipVersion: input.membershipVersion,
          clientInstanceId: input.clientInstanceId,
          sessionExpiresAt,
          issuedAt: now,
          expiresAt,
          authorizationExpiresAt
        }
      });

      return {
        ticket,
        namespace: realtimeCollaborationNamespace,
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        authorizationExpiresAt: authorizationExpiresAt.toISOString()
      };
    });
  }

  public async consume(
    ticket: unknown,
    origin: unknown,
    connectionId: string
  ): Promise<RealtimeAuthorization> {
    if (
      !isRealtimeOpaqueTicket(ticket) ||
      typeof origin !== "string" ||
      !CONNECTION_ID_PATTERN.test(connectionId)
    ) {
      throw unauthorized();
    }
    this.assertAllowedOrigin(origin);
    const ticketHash = digest(ticket);
    const originHash = digest(origin);

    return this.prisma.$transaction(async (transaction) => {
      const candidate =
        await transaction.realtimeProjectTicket.findUnique({
          where: { ticketHash },
          select: { id: true, userId: true, clientInstanceId: true }
        });
      if (!candidate) throw unauthorized();

      await acquireWebPushUserLock(transaction, candidate.userId);
      const now = await databaseNow(transaction);
      await this.assertFamilyActiveByTicket(
        transaction,
        candidate.id
      );

      const activeConnections =
        await transaction.realtimeProjectTicket.count({
          where: {
            userId: candidate.userId,
            consumedAt: { not: null },
            disconnectedAt: null,
            authorizationExpiresAt: { gt: now }
          }
        });
      if (activeConnections >= MAX_ACTIVE_CONNECTIONS_PER_USER) {
        throw rateLimited("Realtime connection limit reached");
      }
      const sameClientConnection =
        await transaction.realtimeProjectTicket.count({
          where: {
            userId: candidate.userId,
            clientInstanceId: candidate.clientInstanceId,
            consumedAt: { not: null },
            disconnectedAt: null,
            authorizationExpiresAt: { gt: now }
          }
        });
      if (sameClientConnection > 0) throw unauthorized();

      const consumed =
        await transaction.realtimeProjectTicket.updateMany({
          where: {
            id: candidate.id,
            ticketHash,
            originHash,
            invalidatedAt: null,
            consumedAt: null,
            expiresAt: { gt: now },
            authorizationExpiresAt: { gt: now },
            sessionExpiresAt: { gte: now }
          },
          data: { consumedAt: now, connectionId }
        });
      if (consumed.count !== 1) throw unauthorized();

      const authorization =
        await transaction.realtimeProjectTicket.findUnique({
          where: { id: candidate.id },
          select: authorizationSelection
        });
      if (!authorization) throw unauthorized();
      return {
        ticketId: authorization.id,
        userId: authorization.userId,
        sessionId: authorization.sessionId,
        sessionFamilyId: authorization.sessionFamilyId,
        workspaceId: authorization.workspaceId,
        projectId: authorization.projectId,
        membershipId: authorization.membershipId,
        membershipVersion: authorization.membershipVersion,
        clientInstanceId: authorization.clientInstanceId,
        authorizationExpiresAt: authorization.authorizationExpiresAt
      };
    });
  }

  public async assertActive(
    authorization: RealtimeAuthorization,
    connectionId: string
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await acquireWebPushUserLock(transaction, authorization.userId);
      const now = await databaseNow(transaction);
      await this.assertFamilyActive(
        transaction,
        authorization.userId,
        authorization.sessionFamilyId
      );
      const active = await transaction.realtimeProjectTicket.count({
        where: {
          id: authorization.ticketId,
          userId: authorization.userId,
          connectionId,
          invalidatedAt: null,
          consumedAt: { not: null },
          disconnectedAt: null,
          authorizationExpiresAt: { gt: now },
          sessionExpiresAt: { gte: now }
        }
      });
      if (active !== 1) throw unauthorized();
    });
  }

  public async disconnect(
    authorization: RealtimeAuthorization,
    connectionId: string
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await acquireWebPushUserLock(transaction, authorization.userId);
      const now = await databaseNow(transaction);
      await transaction.realtimeProjectTicket.updateMany({
        where: {
          id: authorization.ticketId,
          userId: authorization.userId,
          connectionId,
          consumedAt: { not: null },
          disconnectedAt: null
        },
        data: { disconnectedAt: now }
      });
    });
  }

  private assertAllowedOrigin(origin: string): void {
    if (!this.config.webOrigins.includes(origin)) {
      throw new ForbiddenException("Realtime origin is not allowed");
    }
  }

  private async assertFamilyActive(
    transaction: Prisma.TransactionClient,
    userId: string,
    sessionFamilyId: string
  ): Promise<void> {
    const tombstone =
      await transaction.revokedSessionFamilyTombstone.findUnique({
        where: {
          userId_sessionFamilyId: { userId, sessionFamilyId }
        },
        select: { userId: true }
      });
    if (tombstone) throw unauthorized();
  }

  private async assertFamilyActiveByTicket(
    transaction: Prisma.TransactionClient,
    ticketId: string
  ): Promise<void> {
    const ticket = await transaction.realtimeProjectTicket.findUnique({
      where: { id: ticketId },
      select: { userId: true, sessionFamilyId: true }
    });
    if (!ticket) throw unauthorized();
    await this.assertFamilyActive(
      transaction,
      ticket.userId,
      ticket.sessionFamilyId
    );
  }
}

const authorizationSelection = {
  id: true,
  userId: true,
  sessionId: true,
  sessionFamilyId: true,
  workspaceId: true,
  projectId: true,
  membershipId: true,
  membershipVersion: true,
  clientInstanceId: true,
  authorizationExpiresAt: true
} as const;

async function databaseNow(
  transaction: Prisma.TransactionClient
): Promise<Date> {
  const rows = await transaction.$queryRaw<readonly { now: Date }[]>`
    SELECT clock_timestamp() AS "now"
  `;
  const now = rows[0]?.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Realtime database clock is unavailable");
  }
  return now;
}

function digest(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    createHash("sha256").update(value, "utf8").digest()
  );
}

function assertTrustedContext(
  context: InternalProjectContext,
  input: InternalIssueRealtimeProjectTicketInput
): void {
  if (
    input.userId !== context.actorId ||
    input.workspaceId !== context.workspaceId ||
    input.projectId !== context.projectId ||
    input.membershipId !== context.membershipId ||
    input.membershipVersion !== context.membershipVersion
  ) {
    throw new ForbiddenException(
      "Trusted realtime authorization context does not match"
    );
  }
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException("Realtime authorization failed");
}

function rateLimited(message: string): HttpException {
  return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
}
