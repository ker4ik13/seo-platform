import { Controller, Get, Inject } from "@nestjs/common";
import type {
  DependencyHealth,
  HealthResponse
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { NatsService } from "../messaging/nats.service.js";
import { RedisHealthService } from "../redis/redis-health.service.js";

@Controller()
export class HealthController {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly nats: NatsService,
    private readonly redis: RedisHealthService
  ) {}

  @Get(["health/live", "internal/v1/health/live"])
  public live(): HealthResponse {
    return this.response("ok");
  }

  @Get(["health/ready", "internal/v1/health/ready"])
  public async ready(): Promise<HealthResponse> {
    const dependencies = await Promise.all([
      this.check("postgresql", () => this.prisma.ping()),
      this.check("redis", () => this.redis.ping()),
      this.check("nats", () => this.nats.ping())
    ]);

    return this.response(
      dependencies.every(({ status }) => status === "ok")
        ? "ok"
        : "degraded",
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

  private response(
    status: HealthResponse["status"],
    dependencies?: readonly DependencyHealth[]
  ): HealthResponse {
    return {
      service: "realtime",
      version: this.config.version,
      status,
      timestamp: new Date().toISOString(),
      ...(dependencies ? { dependencies } : {})
    };
  }
}
