import { Controller, Get, Inject } from "@nestjs/common";
import type { SystemDescriptor } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

@Controller("internal/v1/system")
export class SystemController {
  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  public descriptor(): SystemDescriptor {
    return {
      service: "seo-data",
      version: this.config.version,
      capabilities: [
        { code: "semantics", status: "planned" },
        { code: "pages", status: "planned" },
        { code: "rank-history", status: "planned" },
        { code: "data-schema", status: "available" }
      ]
    };
  }
}
