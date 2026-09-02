import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticGroupColorLegendState
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid,
  type InternalCommandContext
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalMarkSemanticGroupColorLegendSeenInput,
  internalUpdateSemanticGroupColorLegendInput
} from "./semantic-group-color-legend-input.js";
import { SemanticGroupColorLegendService } from "./semantic-group-color-legend.service.js";

type InternalHeaders = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/projects/:projectId/semantic-group-color-legend")
@UseGuards(PlatformApiGuard)
export class SemanticGroupColorLegendController {
  public constructor(
    private readonly legends: SemanticGroupColorLegendService
  ) {}

  @Get()
  public async get(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticGroupColorLegendState>> {
    const context = routeContext(projectId, headers);
    const data = await this.legends.get(
      context.workspaceId,
      context.projectId,
      context.actorId
    );
    return response(request, data);
  }

  @Patch()
  public async update(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticGroupColorLegendState>> {
    const context = routeContext(projectId, headers);
    const input = internalUpdateSemanticGroupColorLegendInput(body);
    assertInternalContext(context, input);
    return response(request, await this.legends.update(input));
  }

  @Post("seen")
  public async markSeen(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticGroupColorLegendState>> {
    const context = routeContext(projectId, headers);
    const input = internalMarkSemanticGroupColorLegendSeenInput(body);
    assertInternalContext(context, input);
    return response(request, await this.legends.markSeen(input));
  }
}

function routeContext(
  projectId: string,
  headers: InternalHeaders
): InternalCommandContext {
  const context = internalCommandContext(headers);
  if (internalUuid(projectId, "projectId") !== context.projectId) {
    throw new BadRequestException(
      "Route project identifier does not match trusted context"
    );
  }
  return context;
}

function response(
  request: FastifyRequest,
  data: SemanticGroupColorLegendState
): ApiResponse<SemanticGroupColorLegendState> {
  return {
    data,
    meta: {
      requestId: request.id,
      ...(data.version > 0 ? { version: data.version } : {})
    }
  };
}
