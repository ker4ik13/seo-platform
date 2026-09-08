import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PlatformProviderAccountSnapshot } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { internalUuid } from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";

@Controller("internal/v1/platform-admin/provider-accounts")
@UseGuards(PlatformApiGuard)
export class PlatformProviderAccountController {
  public constructor(private readonly prisma: PrismaService) {}
  @Get()
  public async list(@Req() request: FastifyRequest) {
    internalUuid(String(request.headers["x-actor-id"]), "actorId");
    const accounts = await this.prisma.platformProviderAccount.findMany({ orderBy: [{ provider: "asc" }, { slot: "asc" }, { id: "asc" }], take: 128 });
    const data: PlatformProviderAccountSnapshot[] = accounts.map(row => ({ id: row.id, provider: row.provider as PlatformProviderAccountSnapshot["provider"], slot: row.slot, enabled: row.enabled, remaining: row.remaining?.toString() ?? null, unit: row.provider === "XMLSTOCK" ? "RUB" : "ARSENKIN_LIMITS", checkedAt: row.checkedAt?.toISOString() ?? null, errorCode: row.errorCode }));
    return { data, meta: { requestId: request.id } };
  }
}
