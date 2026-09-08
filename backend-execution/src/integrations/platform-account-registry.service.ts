import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { IntegrationCredentialCryptoService, type IntegrationCredentialSecret } from "./integration-credential-crypto.service.js";

@Injectable()
export class PlatformAccountRegistryService implements OnModuleInit {
  public constructor(private readonly prisma: PrismaService, private readonly crypto: IntegrationCredentialCryptoService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  public async onModuleInit(): Promise<void> {
    for (const provider of ["XMLSTOCK", "ARSENKIN"] as const) {
      const material = this.config.platformProviderCredentials[provider];
      if (!material) { await this.prisma.platformProviderAccount.updateMany({ where: { provider, enabled: true }, data: { enabled: false } }); continue; }
      const secret = this.crypto.platformCredentialPoolSecret(provider, material);
      await this.register(provider, secret);
      await this.prisma.platformProviderAccount.updateMany({ where: { provider, id: { notIn: secret.platformPool!.map(entry => entry.id) } }, data: { enabled: false } });
    }
  }
  public async register(provider: "XMLSTOCK" | "ARSENKIN", secret: IntegrationCredentialSecret, credentialId?: string): Promise<void> {
    for (const [index, entry] of (secret.platformPool ?? []).entries()) {
      await this.prisma.platformProviderAccount.upsert({ where: { id: entry.id }, create: { id: entry.id, provider, slot: index + 1, ...(credentialId ? { credentialId } : {}) }, update: { provider, slot: index + 1, enabled: true, ...(credentialId ? { credentialId, nextProbeAt: new Date() } : {}) } });
    }
  }
}
