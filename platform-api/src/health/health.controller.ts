import { Controller, Get, Inject } from "@nestjs/common";
import type {
  DependencyHealth,
  HealthResponse
} from "@seo-platform/contracts";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { NatsService } from "../messaging/nats.service.js";
import { DependencyHealthService } from "./dependency-health.service.js";

@Controller()
export class HealthController {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly nats: NatsService,
    private readonly dependencies: DependencyHealthService
  ) {}

  @Get(["health/live", "internal/v1/health/live"])
  public live(): HealthResponse {
    return this.response("ok");
  }

  @Get(["health/ready", "internal/v1/health/ready"])
  public async ready(): Promise<HealthResponse> {
    const dependencyHealth = await this.readinessDependencies();
    const status = dependencyHealth.every(({ status }) => status === "ok")
      ? "ok"
      : "degraded";

    return this.response(status, dependencyHealth);
  }

  private async readinessDependencies(): Promise<readonly DependencyHealth[]> {
    const databaseStartedAt = performance.now();
    let database: DependencyHealth;

    try {
      await this.prisma.ping();
      database = {
        name: "postgresql",
        status: "ok",
        latencyMs: Math.round(performance.now() - databaseStartedAt)
      };
    } catch {
      database = {
        name: "postgresql",
        status: "unavailable",
        latencyMs: Math.round(performance.now() - databaseStartedAt),
        message: "Database ping failed"
      };
    }

    const natsStartedAt = performance.now();
    let nats: DependencyHealth;

    try {
      await this.nats.ping();
      nats = {
        name: "nats",
        status: "ok",
        latencyMs: Math.round(performance.now() - natsStartedAt)
      };
    } catch {
      nats = {
        name: "nats",
        status: "unavailable",
        latencyMs: Math.round(performance.now() - natsStartedAt),
        message: "NATS ping failed"
      };
    }

    return [database, nats, ...(await this.dependencies.checkAll())];
  }

  private response(
    status: HealthResponse["status"],
    dependencies?: readonly DependencyHealth[]
  ): HealthResponse {
    return {
      service: "platform-api",
      version: this.config.version,
      status,
      timestamp: new Date().toISOString(),
      ...(dependencies ? { dependencies } : {})
    };
  }
}
