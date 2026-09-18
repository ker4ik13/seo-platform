import { Injectable } from "@nestjs/common";
import type { IntegrationProvider } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import type { IntegrationCredentialSecret } from "./integration-credential-crypto.service.js";
import { selectIntegrationCredentialSecret } from "./platform-credential-pool.js";

export class PlatformProviderAccountUnavailableError extends Error {
  public constructor() {
    super("No enabled platform provider account is available");
    this.name = "PlatformProviderAccountUnavailableError";
  }
}

@Injectable()
export class PlatformCredentialPoolSelectionService {
  public constructor(private readonly prisma: PrismaService) {}

  public async select(
    provider: IntegrationProvider,
    secret: IntegrationCredentialSecret,
    affinityId: string,
    fallbackScopeId: string,
    allowDisabledAccount = false
  ): Promise<IntegrationCredentialSecret> {
    if (!secret.platformPool || secret.platformPool.length === 0) {
      return selectIntegrationCredentialSecret(
        secret,
        affinityId,
        fallbackScopeId
      );
    }
    const original = selectIntegrationCredentialSecret(
      secret,
      affinityId,
      fallbackScopeId
    );
    if (allowDisabledAccount) return original;
    const enabled = await this.prisma.$queryRaw<{ readonly id: string }[]>`
      SELECT id
      FROM public.list_enabled_platform_provider_account_ids(
        ${provider}::text,
        ${secret.platformPool.map(({ id }) => id)}::uuid[]
      )
    `;
    const enabledIds = new Set(enabled.map(({ id }) => id));
    if (original.rateLimitScopeId && enabledIds.has(original.rateLimitScopeId)) {
      return original;
    }
    const availablePool = secret.platformPool.filter(({ id }) =>
      enabledIds.has(id)
    );
    if (availablePool.length === 0) {
      throw new PlatformProviderAccountUnavailableError();
    }
    return selectIntegrationCredentialSecret(
      { ...secret, platformPool: availablePool },
      affinityId,
      fallbackScopeId
    );
  }
}
