import {
  Inject,
  Injectable,
  type OnModuleInit
} from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class IntegrationCredentialKeyCoverageService
  implements OnModuleInit
{
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async onModuleInit(): Promise<void> {
    if (!this.config.integrationCredentials.enabled) return;

    const [encryptionVersions, fingerprintVersions] = await Promise.all([
      this.prisma.integrationCredential.groupBy({
        by: ["keyVersion"],
        where: { deletedAt: null }
      }),
      this.prisma.integrationCredential.groupBy({
        by: ["fingerprintKeyVersion"],
        where: { deletedAt: null }
      })
    ]);
    const missingEncryptionKeys = missingKeyVersions(
      encryptionVersions.map((record) => record.keyVersion),
      this.config.integrationCredentials.keys
    );
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
  }
}

export function missingKeyVersions(
  usedVersions: readonly number[],
  configuredKeys: ReadonlyMap<number, Buffer>
): readonly number[] {
  return [...new Set(usedVersions)]
    .filter((version) => !configuredKeys.has(version))
    .sort((left, right) => left - right);
}
