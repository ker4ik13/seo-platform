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
      service: "jobs-integrations",
      version: this.config.version,
      capabilities: [
        { code: "job-queue", status: "available" },
        { code: "s3-multipart", status: this.config.s3.enabled ? "available" : "disabled" },
        { code: "transactional-email", status: this.config.email.enabled ? "available" : "disabled" },
        { code: "xmlstock", status: "planned" },
        { code: "arsenkin", status: "planned" },
        { code: "keys-so", status: "planned" }
      ]
    };
  }
}
