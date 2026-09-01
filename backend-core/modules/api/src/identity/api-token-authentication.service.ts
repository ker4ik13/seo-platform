import { Injectable } from "@nestjs/common";
import {
  apiTokenScopes,
  type ApiTokenScope
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuthCryptoService } from "./auth-crypto.service.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import type {
  ApiTokenAuthorization,
  AuthenticatedPrincipal
} from "./identity.types.js";

const TOKEN_PATTERN = /^seo_pat_[A-Za-z0-9_-]{43}$/u;
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export interface ApiTokenAuthentication {
  readonly principal: AuthenticatedPrincipal;
  readonly authorization: ApiTokenAuthorization;
}

@Injectable()
export class ApiTokenAuthenticationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
    private readonly rateLimits: AuthRateLimitService
  ) {}

  public async authenticate(
    authorizationHeader: string
  ): Promise<ApiTokenAuthentication> {
    const token = bearerToken(authorizationHeader);
    const now = new Date();
    const tokenHash = this.crypto.hashOpaqueToken(token);
    const record = await this.prisma.apiToken.findFirst({
      where: {
        OR: [
          { tokenHash },
          {
            previousTokenHash: tokenHash,
            previousTokenValidUntil: { gt: now }
          }
        ]
      },
      include: {
        creator: { select: { status: true } },
        projectAccesses: {
          orderBy: { projectId: "asc" },
          select: { projectId: true }
        }
      }
    });
    if (
      !record ||
      record.creator.status !== "ACTIVE" ||
      record.revokedAt !== null ||
      (record.expiresAt !== null && record.expiresAt <= now)
    ) {
      invalidToken();
    }
    const scopes = storedScopes(record.scopes);
    await this.rateLimits.consume("API_TOKEN", [record.id]);
    await this.prisma.apiToken.updateMany({
      where: {
        id: record.id,
        OR: [
          { lastUsedAt: null },
          {
            lastUsedAt: {
              lte: new Date(now.getTime() - LAST_USED_WRITE_INTERVAL_MS)
            }
          }
        ]
      },
      data: { lastUsedAt: now }
    });
    return {
      principal: {
        userId: record.createdBy,
        sessionId: record.id,
        sessionFamilyId: record.id,
        authenticatedAt: now,
        expiresAt:
          record.expiresAt ??
          new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000)
      },
      authorization: {
        tokenId: record.id,
        workspaceId: record.workspaceId,
        name: record.name,
        scopes,
        allProjects: record.allProjects,
        projectIds: record.projectAccesses.map(({ projectId }) => projectId)
      }
    };
  }
}

function bearerToken(value: string): string {
  const match = /^Bearer ([^\s]+)$/u.exec(value);
  if (!match?.[1] || !TOKEN_PATTERN.test(match[1])) invalidToken();
  return match[1];
}

function storedScopes(value: unknown): readonly ApiTokenScope[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > apiTokenScopes.length ||
    value.some(
      (scope) =>
        typeof scope !== "string" ||
        !(apiTokenScopes as readonly string[]).includes(scope)
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("Invalid stored API token scopes");
  }
  return value as ApiTokenScope[];
}

function invalidToken(): never {
  throw new DomainError({
    statusCode: 401,
    code: "UNAUTHENTICATED",
    message: "Invalid or expired API token"
  });
}
