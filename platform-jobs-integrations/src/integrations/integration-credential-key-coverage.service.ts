import { Buffer } from "node:buffer";
import {
  Inject,
  Injectable,
  type OnModuleInit
} from "@nestjs/common";
import {
  integrationProviders,
  type IntegrationProvider
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { IntegrationCredentialCryptoService } from "./integration-credential-crypto.service.js";

const PROVIDERS = new Set<string>(integrationProviders);

@Injectable()
export class IntegrationCredentialKeyCoverageService
  implements OnModuleInit
{
  public constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: IntegrationCredentialCryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async onModuleInit(): Promise<void> {
    if (!this.config.integrationCredentials.enabled) return;

    const encryptionVersions =
      await this.prisma.integrationCredential.groupBy({
        by: ["keyVersion"],
        where: { deletedAt: null }
      });
    const usedEncryptionVersions = uniqueSortedVersions(
      encryptionVersions.map((record) => record.keyVersion)
    );
    const missingEncryptionKeys = missingKeyVersions(
      usedEncryptionVersions,
      this.config.integrationCredentials.keys
    );
    const fingerprintVersions =
      this.config.integrationCredentials.role === "MANAGEMENT"
        ? await this.prisma.integrationCredential.groupBy({
            by: ["fingerprintKeyVersion"],
            where: { deletedAt: null }
          })
        : [];
    const missingFingerprintKeys = missingKeyVersions(
      fingerprintVersions.map((record) => record.fingerprintKeyVersion),
      this.config.integrationCredentials.fingerprintKeys
    );
    if (
      missingEncryptionKeys.length > 0 ||
      missingFingerprintKeys.length > 0
    ) {
      throw new Error(
        [
          missingEncryptionKeys.length > 0
            ? `encryption versions: ${missingEncryptionKeys.join(", ")}`
            : undefined,
          missingFingerprintKeys.length > 0
            ? `fingerprint versions: ${missingFingerprintKeys.join(", ")}`
            : undefined
        ]
          .filter(Boolean)
          .join("; ")
          .replace(
            /^/u,
            "Integration credential keyrings do not cover database "
          )
      );
    }

    if (this.config.integrationCredentials.role === "EXECUTION") {
      await this.verifyEncryptionCanaries(usedEncryptionVersions);
    }
  }

  private async verifyEncryptionCanaries(
    usedVersions: readonly number[]
  ): Promise<void> {
    const failedVersions: number[] = [];
    for (const keyVersion of usedVersions) {
      const sample =
        await this.prisma.integrationCredential.findFirst({
          where: { keyVersion, deletedAt: null },
          orderBy: { id: "asc" },
          select: {
            id: true,
            workspaceId: true,
            provider: true,
            ciphertext: true,
            nonce: true,
            authTag: true,
            encryptedDataKey: true,
            dataKeyNonce: true,
            dataKeyAuthTag: true,
            keyVersion: true
          }
        });
      if (!sample) {
        failedVersions.push(keyVersion);
        continue;
      }
      try {
        this.crypto.decrypt(
          sample.workspaceId,
          providerValue(sample.provider),
          sample.id,
          {
            ciphertext: Buffer.from(sample.ciphertext),
            nonce: Buffer.from(sample.nonce),
            authTag: Buffer.from(sample.authTag),
            encryptedDataKey: Buffer.from(sample.encryptedDataKey),
            dataKeyNonce: Buffer.from(sample.dataKeyNonce),
            dataKeyAuthTag: Buffer.from(sample.dataKeyAuthTag),
            keyVersion: sample.keyVersion
          }
        );
      } catch {
        failedVersions.push(keyVersion);
      }
    }
    if (failedVersions.length > 0) {
      throw new Error(
        `Integration credential decrypt canary failed for encryption versions: ${failedVersions.join(", ")}`
      );
    }
  }
}

export function missingKeyVersions(
  usedVersions: readonly number[],
  configuredKeys: ReadonlyMap<number, Buffer>
): readonly number[] {
  return uniqueSortedVersions(usedVersions)
    .filter((version) => !configuredKeys.has(version));
}

function uniqueSortedVersions(
  versions: readonly number[]
): readonly number[] {
  return [...new Set(versions)].sort((left, right) => left - right);
}

function providerValue(value: string): IntegrationProvider {
  if (!PROVIDERS.has(value)) {
    throw new Error("Unsupported integration provider in canary sample");
  }
  return value as IntegrationProvider;
}
