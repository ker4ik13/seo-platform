import {
  Injectable,
  type CanActivate,
  type ExecutionContext
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { DomainError } from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { PlatformRoleCode } from "../generated/prisma/client.js";
import type { AuthenticatedRequest } from "../identity/identity.types.js";
import { RecentAuthenticationService } from "../identity/recent-authentication.service.js";
import {
  PLATFORM_ROLES_METADATA,
  PLATFORM_RECENT_AUTH_METADATA
} from "./platform-role.js";

export type PlatformAdminRequest = FastifyRequest & {
  principal?: NonNullable<AuthenticatedRequest["principal"]>;
  platformRoles?: readonly PlatformRoleCode[];
};

@Injectable()
export class PlatformRoleGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly recentAuthentication: RecentAuthenticationService
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PlatformAdminRequest>();
    const principal = request.principal;
    if (!principal) {
      throw new DomainError({
        statusCode: 401,
        code: "UNAUTHENTICATED",
        message: "Authentication required"
      });
    }
    // Operational settings use the valid MFA-backed session. Only explicitly
    // marked high-risk mutations require the short recent-auth window.
    if (!["GET", "HEAD"].includes(request.method) && this.reflector.getAllAndOverride<boolean>(PLATFORM_RECENT_AUTH_METADATA, [context.getHandler(), context.getClass()]) === true) {
      this.recentAuthentication.assert(principal);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: {
        status: true,
        emailVerifiedAt: true,
        mfaMethods: {
          where: {
            status: "ACTIVE",
            disabledAt: null,
            confirmedAt: { not: null }
          },
          select: { confirmedAt: true },
          take: 1
        },
        platformRoles: {
          where: { revokedAt: null },
          select: { roleCode: true }
        }
      }
    });
    const confirmedAt = user?.mfaMethods[0]?.confirmedAt;
    if (
      !user ||
      user.status !== "ACTIVE" ||
      !user.emailVerifiedAt ||
      !confirmedAt ||
      confirmedAt > principal.authenticatedAt
    ) {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message:
          "Platform administration requires an active verified account and MFA-authenticated session"
      });
    }

    const roles = user.platformRoles.map((assignment) => assignment.roleCode);
    const required =
      this.reflector.getAllAndOverride<readonly PlatformRoleCode[]>(
        PLATFORM_ROLES_METADATA,
        [context.getHandler(), context.getClass()]
      ) ?? [];
    if (
      roles.length === 0 ||
      (required.length > 0 &&
        !roles.includes("SUPER_ADMIN") &&
        !required.some((role) => roles.includes(role)))
    ) {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "The required platform role is not assigned"
      });
    }
    request.platformRoles = roles;
    return true;
  }
}
