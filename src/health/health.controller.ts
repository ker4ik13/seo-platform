import { Controller, Get, Inject } from "@nestjs/common";
import type {
  DependencyHealth,
  HealthResponse
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMAIL, type EmailPort } from "../email/email.port.js";
import { NatsService } from "../messaging/nats.service.js";
import { QueueService } from "../queue/queue.service.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort
} from "../storage/object-storage.port.js";

@Controller()
export class HealthController {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly nats: NatsService,
    private readonly queue: QueueService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(EMAIL) private readonly email: EmailPort
  ) {}

  @Get(["health/live", "internal/v1/health/live"])
  public live(): HealthResponse {
    return this.response("ok");
  }

  @Get(["health/ready", "internal/v1/health/ready"])
  public async ready(): Promise<HealthResponse> {
    const required = await Promise.all([
      this.check("postgresql", () => this.prisma.ping()),
      this.check("redis", () => this.queue.ping()),
      this.check("nats", () => this.nats.ping())
    ]);
    const optional = await Promise.all([
      this.checkOptional("s3", this.storage),
      this.checkOptional("email", this.email)
    ]);
    const dependencies = [...required, ...optional];

    return this.response(
      required.every(({ status }) => status === "ok") ? "ok" : "degraded",
      dependencies
    );
  }

  private async check(
    name: string,
    operation: () => Promise<void>
  ): Promise<DependencyHealth> {
    const startedAt = performance.now();
    try {
      await operation();
      return {
        name,
        status: "ok",
        latencyMs: Math.round(performance.now() - startedAt)
      };
    } catch {
      return {
        name,
        status: "unavailable",
        latencyMs: Math.round(performance.now() - startedAt)
      };
    }
  }

  private checkOptional(
    name: string,
    adapter: Pick<EmailPort, "isEnabled" | "healthCheck">
  ): Promise<DependencyHealth> {
    if (!adapter.isEnabled()) {
      return Promise.resolve({
        name,
        status: "degraded",
        message: "Adapter is intentionally disabled"
      });
    }
    return this.check(name, () => adapter.healthCheck());
  }

  private response(
    status: HealthResponse["status"],
    dependencies?: readonly DependencyHealth[]
  ): HealthResponse {
    return {
      service: "jobs-integrations",
      version: this.config.version,
      status,
      timestamp: new Date().toISOString(),
      ...(dependencies ? { dependencies } : {})
    };
  }
}
