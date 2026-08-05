import { Module } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { DisabledEmailAdapter } from "./disabled-email.adapter.js";
import { EMAIL, type EmailPort } from "./email.port.js";
import { SmtpEmailAdapter } from "./smtp-email.adapter.js";

@Module({
  providers: [
    {
      provide: EMAIL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailPort =>
        config.email.enabled
          ? new SmtpEmailAdapter(config.email)
          : new DisabledEmailAdapter()
    }
  ],
  exports: [EMAIL]
})
export class EmailModule {}
