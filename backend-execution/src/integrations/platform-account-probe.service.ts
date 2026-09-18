import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { ArsenkinCredentialValidationConnector } from "./arsenkin-credential-validation.connector.js";
import type { CredentialValidationResult } from "./integration-credential-validation.connector.js";
import { PlatformAccountRegistryService, type ConfiguredPlatformAccount } from "./platform-account-registry.service.js";
import { XmlStockCredentialValidationConnector } from "./xmlstock-credential-validation.connector.js";

const DISPATCH_INTERVAL_MS = 5_000;
const SUCCESS_PROBE_INTERVAL_MS = 15 * 60_000;
const FAILURE_PROBE_INTERVAL_MS = 5 * 60_000;
const LEASE_MS = 90_000;

@Injectable()
export class PlatformAccountProbeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly owner = `account-probe-${randomUUID()}`;
  private readonly logger = new Logger(PlatformAccountProbeService.name);
  private readonly xmlStock = new XmlStockCredentialValidationConnector();
  private readonly arsenkin = new ArsenkinCredentialValidationConnector({
    async tryAcquire() {
      return { allowed: true as const };
    }
  });
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private running = false;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: PlatformAccountRegistryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public onApplicationBootstrap(): void {
    this.schedule(1_000);
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.timer);
    while (this.running) await new Promise(resolve => setTimeout(resolve, 50));
  }

  public async requestProbe(accountId?: string): Promise<number> {
    const configuredIds = accountId
      ? this.accounts.configuredAccountIds().filter(id => id === accountId)
      : this.accounts.configuredAccountIds();
    if (configuredIds.length === 0) return 0;
    const result = await this.prisma.platformProviderAccount.updateMany({
      where: { id: { in: [...configuredIds] }, enabled: true },
      data: { nextProbeAt: new Date() }
    });
    this.wake();
    return result.count;
  }

  public async probeOne(): Promise<boolean> {
    const configured = this.accounts.configuredAccounts();
    if (configured.length === 0) return false;
    const now = new Date();
    const candidate = await this.prisma.platformProviderAccount.findFirst({
      where: {
        id: { in: configured.map(({ id }) => id) },
        enabled: true,
        nextProbeAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
      },
      orderBy: [{ nextProbeAt: "asc" }, { id: "asc" }]
    });
    if (!candidate) return false;
    const token = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
    const claimed = await this.prisma.platformProviderAccount.updateMany({
      where: {
        id: candidate.id,
        enabled: true,
        nextProbeAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
      },
      data: {
        leaseOwner: this.owner,
        leaseToken: token,
        leaseExpiresAt
      }
    });
    if (claimed.count !== 1) return true;

    const account = configured.find(({ id }) => id === candidate.id);
    if (!account) return true;
    const observation = await this.observe(account);
    const checkedAt = new Date();
    await this.prisma.platformProviderAccount.updateMany({
      where: {
        id: account.id,
        enabled: true,
        leaseOwner: this.owner,
        leaseToken: token,
        leaseExpiresAt: { gt: checkedAt }
      },
      data: {
        ...(observation.remaining === null
          ? {}
          : { remaining: observation.remaining }),
        checkedAt,
        errorCode: observation.errorCode,
        nextProbeAt: new Date(
          checkedAt.getTime() +
            (observation.errorCode
              ? FAILURE_PROBE_INTERVAL_MS
              : SUCCESS_PROBE_INTERVAL_MS)
        ),
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null
      }
    });
    return true;
  }

  private async observe(account: ConfiguredPlatformAccount): Promise<{
    readonly remaining: string | null;
    readonly errorCode: string | null;
  }> {
    let result: CredentialValidationResult;
    try {
      result = await (account.provider === "XMLSTOCK"
        ? this.xmlStock
        : this.arsenkin
      ).validate(
        account.secret,
        Math.min(
          10_000,
          this.config.integrationCredentialValidation.timeoutMs
        )
      );
    } catch {
      return { remaining: null, errorCode: "ACCOUNT_PROBE_FAILED" };
    }
    if (!result.ok) {
      return { remaining: null, errorCode: result.errorCode };
    }
    const accountMeta = result.providerMeta?.account;
    const candidate = account.provider === "ARSENKIN"
      ? result.providerMeta?.limitsTotal
      : accountMeta && typeof accountMeta === "object" && !Array.isArray(accountMeta)
        ? (accountMeta as Record<string, unknown>).balance
        : undefined;
    if (
      (typeof candidate !== "number" && typeof candidate !== "string") ||
      !/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,6})?$/u.test(String(candidate))
    ) {
      return { remaining: null, errorCode: "PROVIDER_INVALID_RESPONSE" };
    }
    return { remaining: String(candidate), errorCode: null };
  }

  private schedule(ms: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref();
  }

  private wake(): void {
    if (this.stopping || this.running) return;
    clearTimeout(this.timer);
    this.schedule(0);
  }

  private async tick(): Promise<void> {
    if (this.stopping || this.running) return;
    this.running = true;
    try {
      for (let count = 0; count < 10 && !this.stopping; count += 1) {
        if (!await this.probeOne()) break;
      }
    } catch {
      this.logger.warn("PLATFORM_ACCOUNT_PROBE_UNAVAILABLE");
    } finally {
      this.running = false;
      this.schedule(DISPATCH_INTERVAL_MS);
    }
  }
}
