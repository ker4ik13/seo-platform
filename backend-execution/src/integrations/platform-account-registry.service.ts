import {
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit
} from "@nestjs/common";
import type { IntegrationProvider } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  IntegrationCredentialCryptoService,
  type IntegrationCredentialSecret
} from "./integration-credential-crypto.service.js";

type PlatformProvider = Extract<IntegrationProvider, "XMLSTOCK" | "ARSENKIN">;
export interface ConfiguredPlatformAccount {
  readonly id: string;
  readonly provider: PlatformProvider;
  readonly slot: number;
  readonly secret: IntegrationCredentialSecret;
}

@Injectable()
export class PlatformAccountRegistryService implements OnModuleInit {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: IntegrationCredentialCryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}
  public async onModuleInit(): Promise<void> {
    for (const provider of ["XMLSTOCK", "ARSENKIN"] as const) {
      const material = this.config.platformProviderCredentials[provider];
      if (!material) {
        await this.prisma.platformProviderAccount.updateMany({
          where: { provider, enabled: true },
          data: { enabled: false }
        });
        continue;
      }
      const secret = this.crypto.platformCredentialPoolSecret(provider, material);
      await this.register(provider, secret);
      await this.prisma.platformProviderAccount.updateMany({
        where: {
          provider,
          id: { notIn: secret.platformPool!.map(entry => entry.id) }
        },
        data: { enabled: false }
      });
    }
  }
  public configuredAccounts(
    provider?: PlatformProvider
  ): readonly ConfiguredPlatformAccount[] {
    const providers = provider
      ? [provider]
      : (["XMLSTOCK", "ARSENKIN"] as const);
    return providers.flatMap(currentProvider => {
      const material = this.config.platformProviderCredentials[currentProvider];
      if (!material) return [];
      const pool = this.crypto.platformCredentialPoolSecret(
        currentProvider,
        material
      ).platformPool ?? [];
      return pool.map((entry, index) => ({
        id: entry.id,
        provider: currentProvider,
        slot: index + 1,
        secret: {
          apiKey: entry.apiKey,
          ...(entry.accountIdentifier
            ? { accountIdentifier: entry.accountIdentifier }
            : {}),
          rateLimitScopeId: entry.id
        }
      }));
    });
  }
  public configuredAccountIds(): readonly string[] {
    return this.configuredAccounts().map(({ id }) => id);
  }
  public async register(
    provider: PlatformProvider,
    secret: IntegrationCredentialSecret,
    credentialId?: string
  ): Promise<void> {
    for (const [index, entry] of (secret.platformPool ?? []).entries()) {
      await this.prisma.platformProviderAccount.upsert({
        where: { id: entry.id },
        create: {
          id: entry.id,
          provider,
          slot: index + 1,
          ...(credentialId ? { credentialId } : {})
        },
        update: {
          provider,
          slot: index + 1,
          nextProbeAt: new Date(),
          ...(credentialId ? { credentialId } : {})
        }
      });
    }
  }
  public async setEnabled(accountId: string, enabled: boolean): Promise<void> {
    if (!this.configuredAccountIds().includes(accountId)) {
      throw new NotFoundException("Platform provider account not found");
    }
    const changed = await this.prisma.platformProviderAccount.updateMany({
      where: { id: accountId },
      data: enabled
        ? { enabled: true, nextProbeAt: new Date() }
        : {
            enabled: false,
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null
          }
    });
    if (changed.count !== 1) {
      throw new NotFoundException("Platform provider account not found");
    }
  }
}
