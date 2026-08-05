import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalProjectSeoTransferResult
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { internalProjectWorkspaceTransferInput } from "./project-workspace-transfer.input.js";
import { ProjectWorkspaceTransferService } from "./project-workspace-transfer.service.js";

@Controller("internal/v1/projects/:projectId/workspace-transfer")
@UseGuards(PlatformApiGuard)
export class ProjectWorkspaceTransferController {
  public constructor(private readonly transfers: ProjectWorkspaceTransferService) {}

  @Post()
  public async transfer(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalProjectSeoTransferResult>> {
    const context = internalCommandContext(headers);
    const input = internalProjectWorkspaceTransferInput(body);
    assertInternalContext(input, context);
    if (
      input.projectId !== internalUuid(projectId, "projectId") ||
      input.workspaceId === input.destinationWorkspaceId
    ) {
      throw new BadRequestException("Project workspace transfer route does not match command");
    }
    return {
      data: await this.transfers.transfer(
        input.workspaceId,
        input.destinationWorkspaceId,
        input.projectId
      ),
      meta: { requestId: request.id }
    };
  }
}
