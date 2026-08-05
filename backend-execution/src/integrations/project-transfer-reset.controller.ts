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
  InternalProjectExecutionResetResult
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { IntegrationCredentialApiGuard } from "./integration-credential-api.guard.js";
import { internalProjectTransferResetInput } from "./project-transfer-reset.input.js";
import { ProjectTransferResetService } from "./project-transfer-reset.service.js";

@Controller("internal/v1/workspaces/:workspaceId/projects/:projectId/transfer-reset")
@UseGuards(IntegrationCredentialApiGuard)
export class ProjectTransferResetController {
  public constructor(private readonly resets: ProjectTransferResetService) {}

  @Post()
  public async reset(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalProjectExecutionResetResult>> {
    const context = internalCommandContext(headers);
    const input = internalProjectTransferResetInput(body);
    assertInternalContext(input, context);
    if (
      input.workspaceId !== internalUuid(workspaceId, "workspaceId") ||
      input.projectId !== internalUuid(projectId, "projectId") ||
      input.destinationWorkspaceId === input.workspaceId
    ) {
      throw new BadRequestException("Project transfer reset route does not match command");
    }
    return {
      data: await this.resets.reset(input.workspaceId, input.projectId),
      meta: { requestId: request.id }
    };
  }
}
