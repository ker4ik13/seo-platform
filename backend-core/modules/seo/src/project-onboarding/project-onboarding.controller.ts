import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { parseInternalInitializeProjectOnboardingInput } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  assertInternalContext,
  internalCommandContext,
} from "../internal/internal-command-context.js";
import { ProjectOnboardingService } from "./project-onboarding.service.js";

@Controller("internal/v1/projects/:projectId/onboarding")
@UseGuards(PlatformApiGuard)
export class ProjectOnboardingController {
  public constructor(private readonly onboarding: ProjectOnboardingService) {}
  @Post()
  public async initialize(
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    let input;
    try {
      input = parseInternalInitializeProjectOnboardingInput(body);
    } catch {
      throw new BadRequestException("Invalid project onboarding command");
    }
    const context = internalCommandContext(headers);
    if (context.projectId !== projectId.toLowerCase())
      throw new BadRequestException(
        "Project route does not match trusted context",
      );
    assertInternalContext(context, input);
    return {
      data: await this.onboarding.initialize(input),
      meta: { requestId: request.id },
    };
  }
}
