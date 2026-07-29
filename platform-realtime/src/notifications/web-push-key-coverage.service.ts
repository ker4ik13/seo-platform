import {
  Inject,
  Injectable,
  type OnApplicationBootstrap
} from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";

@Injectable()
export class WebPushKeyCoverageService
  implements OnApplicationBootstrap
{
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    const versions = await this.prisma.webPushSubscription.findMany({
      where: { status: "ACTIVE" },
      distinct: ["encryptionKeyVersion", "fingerprintKeyVersion"],
      select: {
        encryptionKeyVersion: true,
        fingerprintKeyVersion: true
      }
    });
    for (const version of versions) {
      if (
        version.encryptionKeyVersion === null ||
        version.fingerprintKeyVersion === null ||
        !this.config.webPush.subscriptionKeys.has(
          version.encryptionKeyVersion
        ) ||
        !this.config.webPush.fingerprintKeys.has(
          version.fingerprintKeyVersion
        )
      ) {
        throw new Error(
          "Web Push keyring does not cover every active subscription"
        );
      }
    }
  }
}
