import { BadRequestException, Body, Controller, Patch, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { apiResponse } from "../common/api-response.js";
import { PrismaService } from "../database/prisma.service.js";
import { CurrentPrincipal } from "./current-principal.js";
import { toUserSummary } from "./identity.mapper.js";
import type { AuthenticatedPrincipal } from "./identity.types.js";
import { CsrfSessionGuard } from "./session-auth.guard.js";
import { SessionService } from "./session.service.js";
@Controller("api/v1/me/preferences")
@UseGuards(CsrfSessionGuard)
export class UserPreferencesController {
  public constructor(private readonly prisma: PrismaService, private readonly sessions: SessionService, private readonly audit: AuditService) {}
  @Patch()
  public async update(@Body() body: unknown, @Req() request: FastifyRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("locale" in body) || (body.locale !== "ru" && body.locale !== "en")) throw new BadRequestException("Select Russian or English");
    const locale = body.locale;
    const user = await this.prisma.$transaction(async tx => {
      await this.sessions.assertSessionLifecyclePrincipal(tx, principal);
      const current = await tx.user.findUniqueOrThrow({ where: { id: principal.userId } });
      if (current.locale === locale) return current;
      const updated = await tx.user.update({ where: { id: principal.userId }, data: { locale, version: { increment: 1 } } });
      await this.audit.record({ actorId: principal.userId, action: "identity.preferences.updated", resourceType: "user", resourceId: principal.userId, requestId: request.id }, tx);
      return updated;
    });
    return apiResponse(request, toUserSummary(user));
  }
}
