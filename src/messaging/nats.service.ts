import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import {
  connect,
  type NatsConnection
} from "@nats-io/transport-node";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

@Injectable()
export class NatsService implements OnModuleInit, OnModuleDestroy {
  private connection?: NatsConnection;

  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async onModuleInit(): Promise<void> {
    this.connection = await connect({
      servers: this.config.nats.url,
      name: "realtime",
      ...(this.config.nats.user ? { user: this.config.nats.user } : {}),
      ...(this.config.nats.password
        ? { pass: this.config.nats.password }
        : {})
    });
  }

  public async ping(): Promise<void> {
    if (!this.connection) throw new Error("NATS connection is not initialized");
    await this.connection.flush();
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.connection) await this.connection.drain();
  }
}
