import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  public constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const adapter = new PrismaPg({
      connectionString: config.databaseUrl,
      max: config.databasePoolMax,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000
    });

    super({ adapter });
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  public async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
