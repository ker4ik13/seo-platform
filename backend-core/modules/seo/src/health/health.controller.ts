import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Res
} from "@nestjs/common";
import type {
  DependencyHealth,
  HealthResponse
} from "@seo-platform/contracts";
import type { FastifyReply } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { NatsService } from "../messaging/nats.service.js";

@Controller()
export class HealthController {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly nats: NatsService
  ) {}

  @Get(["health/live", "internal/v1/health/live"])
  public live(): HealthResponse {
    return this.response("ok");
  }

  @Get(["health/ready", "internal/v1/health/ready"])
  public async ready(
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<HealthResponse> {
    const dependencies = await Promise.all([
      this.check("postgresql", () => this.prisma.ping()),
      this.check("nats", () => this.nats.ping())
    ]);
    const status = dependencies.every(({ status }) => status === "ok")
      ? "ok"
      : "degraded";

    reply.code(
      status === "ok" ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE
    );
    return this.response(status, dependencies);
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
      service: "seo-data",
      version: this.config.version,
      status,
      timestamp: new Date().toISOString(),
      ...(dependencies ? { dependencies } : {})
    };
  }
}
