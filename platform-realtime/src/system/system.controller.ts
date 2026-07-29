import { Controller, Get, Inject } from "@nestjs/common";
import type { ApiResponse, SystemDescriptor } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

@Controller("internal/v1/system")
export class SystemController {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  @Get()
  public descriptor(): ApiResponse<SystemDescriptor> {
    return {
      data: {
        service: "realtime",
        version: this.config.version,
        capabilities: [
          { code: "presence", status: "planned" },
          { code: "cell-selection", status: "planned" },
          { code: "collaborative-documents", status: "planned" },
          { code: "comments", status: "planned" }
        ]
      },
      meta: { requestId: "bootstrap" }
    };
  }
}
