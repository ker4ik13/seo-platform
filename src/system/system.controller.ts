import { Controller, Get, Inject } from "@nestjs/common";
import type { ApiResponse, SystemDescriptor } from "@seo-platform/contracts";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";

@Controller(["api/v1/system", "internal/v1/system"])
export class SystemController {
  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  public descriptor(): ApiResponse<SystemDescriptor> {
    return {
      data: {
        service: "platform-api",
        version: this.config.version,
        capabilities: [
          { code: "identity", status: "available" },
          { code: "workspaces", status: "planned" },
          { code: "projects", status: "planned" },
          { code: "billing", status: "planned" },
          { code: "service-orchestration", status: "available" }
        ]
      },
      meta: {
        requestId: "bootstrap"
      }
    };
  }
}
