import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticSavedView
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCreateSemanticSavedViewInput,
  internalDeleteSemanticSavedViewInput,
  internalUpdateSemanticSavedViewInput
} from "./semantic-saved-view-input.js";
import { SemanticSavedViewService } from "./semantic-saved-view.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/projects/:projectId/semantic-saved-views")
@UseGuards(PlatformApiGuard)
export class SemanticSavedViewController {
  public constructor(private readonly views: SemanticSavedViewService) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticSavedView[]>> {
    const context = routeContext(projectId, headers);
    return {
      data: await this.views.list(
        context.workspaceId,
        context.projectId,
        context.actorId
      ),
      meta: { requestId: request.id }
    };
  }

  @Post()
  public async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticSavedView>> {
    const input = internalCreateSemanticSavedViewInput(body);
    assertMutation(projectId, headers, input);
    return response(request, await this.views.create(input));
  }

  @Patch(":viewId")
  public async update(
    @Param("projectId") projectId: string,
    @Param("viewId") viewId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticSavedView>> {
    const input = internalUpdateSemanticSavedViewInput(body);
    assertMutation(projectId, headers, input);
    return response(
      request,
      await this.views.update(internalUuid(viewId, "viewId"), input)
    );
  }

  @Delete(":viewId")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(
    @Param("projectId") projectId: string,
    @Param("viewId") viewId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders
  ): Promise<void> {
    const input = internalDeleteSemanticSavedViewInput(body);
    assertMutation(projectId, headers, input);
    await this.views.delete(internalUuid(viewId, "viewId"), input);
  }
}

function routeContext(projectId: string, headers: InternalHeaders) {
  const context = internalCommandContext(headers);
  if (internalUuid(projectId, "projectId") !== context.projectId) {
    throw new BadRequestException(
      "Route project identifier does not match trusted context"
    );
  }
  return context;
}

function assertMutation(
  projectId: string,
  headers: InternalHeaders,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actorId: string;
  }
): void {
  assertInternalContext(routeContext(projectId, headers), input);
}

function response(
  request: FastifyRequest,
  data: SemanticSavedView
): ApiResponse<SemanticSavedView> {
  return {
    data,
    meta: { requestId: request.id, version: data.version }
  };
}
