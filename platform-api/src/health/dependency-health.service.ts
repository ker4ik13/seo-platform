import { Inject, Injectable } from "@nestjs/common";
import type { DependencyHealth } from "@seo-platform/contracts";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";

@Injectable()
export class DependencyHealthService {
  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async checkAll(): Promise<readonly DependencyHealth[]> {
    return Promise.all([
      this.check("seo-data", this.config.services.seoData),
      this.check("jobs-integrations", this.config.services.jobs),
      this.check("realtime", this.config.services.realtime)
    ]);
  }

  private async check(name: string, baseUrl: string): Promise<DependencyHealth> {
    const startedAt = performance.now();

    try {
      const response = await fetch(`${baseUrl}/internal/v1/health/live`, {
        signal: AbortSignal.timeout(this.config.dependencyTimeoutMs)
      });
      const latencyMs = Math.round(performance.now() - startedAt);

      if (!response.ok) {
        return {
          name,
          status: "unavailable",
          latencyMs,
          message: `HTTP ${response.status}`
        };
      }

      return { name, status: "ok", latencyMs };
    } catch {
      return {
        name,
        status: "unavailable",
        latencyMs: Math.round(performance.now() - startedAt),
        message: "Dependency request failed"
      };
    }
  }
}
