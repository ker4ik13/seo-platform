import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PlatformProviderAccountSnapshot } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { internalUuid } from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { PlatformAccountProbeService } from "./platform-account-probe.service.js";
import { PlatformAccountRegistryService } from "./platform-account-registry.service.js";

@Controller("internal/v1/platform-admin/provider-accounts")
@UseGuards(PlatformApiGuard)
export class PlatformProviderAccountController {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PlatformAccountRegistryService,
    private readonly probes: PlatformAccountProbeService
  ) {}
  @Get()
  public async list(@Req() request: FastifyRequest) {
    internalUuid(String(request.headers["x-actor-id"]), "actorId");
    const data = await this.accounts();
    return { data, meta: { requestId: request.id } };
  }

  @Post("refresh")
  public async refresh(@Req() request: FastifyRequest) {
    internalUuid(String(request.headers["x-actor-id"]), "actorId");
    const requested = await this.probes.requestProbe();
    return { data: { requested }, meta: { requestId: request.id } };
  }

  @Post(":accountId/enabled")
  public async setEnabled(
    @Param("accountId") accountId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ) {
    internalUuid(String(request.headers["x-actor-id"]), "actorId");
    const id = internalUuid(accountId, "accountId");
    const enabled = enabledInput(body);
    await this.registry.setEnabled(id, enabled);
    if (enabled) await this.probes.requestProbe(id);
    const account = (await this.accounts()).find(({ id: value }) => value === id);
    if (!account) throw new BadRequestException("Platform provider account is not configured");
    return { data: account, meta: { requestId: request.id } };
  }

  private async accounts(): Promise<readonly PlatformProviderAccountSnapshot[]> {
    const configuredIds = this.registry.configuredAccountIds();
    if (configuredIds.length === 0) return [];
    const accounts = await this.prisma.platformProviderAccount.findMany({ where: { id: { in: [...configuredIds] } }, orderBy: [{ provider: "asc" }, { slot: "asc" }, { id: "asc" }], take: 128 });
    const now = Date.now();
    return accounts.map(row => ({ id: row.id, provider: row.provider as PlatformProviderAccountSnapshot["provider"], slot: row.slot, enabled: row.enabled, checking: row.enabled && Boolean(row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now), remaining: row.remaining?.toString() ?? null, unit: row.provider === "XMLSTOCK" ? "RUB" : "ARSENKIN_LIMITS", checkedAt: row.checkedAt?.toISOString() ?? null, errorCode: row.errorCode }));
  }
}

function enabledInput(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Invalid provider account command");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input.enabled !== "boolean") throw new BadRequestException("Invalid provider account command");
  return input.enabled;
}
