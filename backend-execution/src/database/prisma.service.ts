import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaClient } from "../generated/prisma/client.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  public constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        max: config.databasePoolMax,
        connectionTimeoutMillis:
          config.processRole === "CONNECTOR_WORKER" ? 15_000 : 5_000,
        idleTimeoutMillis: 10_000
      })
    });
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  public async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
