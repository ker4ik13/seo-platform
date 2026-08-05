import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

@Injectable()
export class RedisHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly client: RedisClientType;

  public constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = createClient({ url: config.redisUrl });
  }

  public async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  public async ping(): Promise<void> {
    await this.client.ping();
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.close();
  }
}
