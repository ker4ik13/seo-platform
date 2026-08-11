import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  AdminProjectSemanticCounts,
  ApiResponse
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { internalUuid } from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { adminProjectIds } from "./platform-admin-read-input.js";
import { PlatformAdminReadService } from "./platform-admin-read.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/platform-admin/project-statistics")
@UseGuards(PlatformApiGuard)
export class PlatformAdminReadController {
  public constructor(private readonly admin: PlatformAdminReadService) {}

  @Post()
  public async projectStatistics(
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{
    readonly projects: readonly AdminProjectSemanticCounts[];
  }>> {
    const actor = headers["x-actor-id"];
    if (typeof actor !== "string") {
      throw new BadRequestException("Missing trusted internal actor");
    }
    internalUuid(actor, "actorId");
    return {
      data: { projects: await this.admin.projectCounts(adminProjectIds(body)) },
      meta: { requestId: request.id }
    };
  }
}
