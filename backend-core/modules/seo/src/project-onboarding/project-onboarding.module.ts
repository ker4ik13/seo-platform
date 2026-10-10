import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { ProjectOnboardingController } from "./project-onboarding.controller.js";
import { ProjectOnboardingService } from "./project-onboarding.service.js";

@Module({
  imports: [InternalModule],
  controllers: [ProjectOnboardingController],
  providers: [ProjectOnboardingService],
})
export class ProjectOnboardingModule {}
