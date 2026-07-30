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
  SemanticKeywordGroup
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCreateSemanticKeywordGroupInput,
  internalDeleteSemanticKeywordGroupInput,
  internalUpdateSemanticKeywordGroupInput
} from "./keyword-group-input.js";
import { KeywordGroupService } from "./keyword-group.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/projects/:projectId/keyword-groups")
@UseGuards(PlatformApiGuard)
export class KeywordGroupController {
  public constructor(private readonly groups: KeywordGroupService) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticKeywordGroup[]>> {
    const context = routeContext(projectId, headers);
    return {
      data: await this.groups.list(context.workspaceId, context.projectId),
      meta: { requestId: request.id }
    };
  }

  @Post()
  public async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordGroup>> {
    const input = internalCreateSemanticKeywordGroupInput(body);
    assertMutation(projectId, headers, input);
    const data = await this.groups.create(input);
    return response(request, data);
  }

  @Patch(":groupId")
  public async update(
    @Param("projectId") projectId: string,
    @Param("groupId") groupId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordGroup>> {
    const input = internalUpdateSemanticKeywordGroupInput(body);
    assertMutation(projectId, headers, input);
    const data = await this.groups.update(
      internalUuid(groupId, "groupId"),
      input
    );
    return response(request, data);
  }

  @Delete(":groupId")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(
    @Param("projectId") projectId: string,
    @Param("groupId") groupId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders
  ): Promise<void> {
    const input = internalDeleteSemanticKeywordGroupInput(body);
    assertMutation(projectId, headers, input);
    await this.groups.delete(internalUuid(groupId, "groupId"), input);
  }
}

function routeContext(
  projectId: string,
  headers: InternalHeaders
) {
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
  const context = routeContext(projectId, headers);
  assertInternalContext(context, input);
}

function response(
  request: FastifyRequest,
  data: SemanticKeywordGroup
): ApiResponse<SemanticKeywordGroup> {
  return {
    data,
    meta: { requestId: request.id, version: data.version }
  };
}
