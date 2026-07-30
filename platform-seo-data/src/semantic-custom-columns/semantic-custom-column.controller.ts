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
  Put,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  SemanticCustomColumn,
  SemanticKeywordCustomValue
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCreateSemanticCustomColumnInput,
  internalDeleteSemanticCustomColumnInput,
  internalDeleteSemanticKeywordCustomValueInput,
  internalSetSemanticKeywordCustomValueInput,
  internalUpdateSemanticCustomColumnInput
} from "./semantic-custom-column-input.js";
import { SemanticCustomColumnService } from "./semantic-custom-column.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/projects/:projectId")
@UseGuards(PlatformApiGuard)
export class SemanticCustomColumnController {
  public constructor(private readonly columns: SemanticCustomColumnService) {}

  @Get("semantic-custom-columns")
  public async list(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticCustomColumn[]>> {
    const context = routeContext(projectId, headers);
    return {
      data: await this.columns.list(context.workspaceId, context.projectId),
      meta: { requestId: request.id }
    };
  }

  @Post("semantic-custom-columns")
  public async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticCustomColumn>> {
    const input = internalCreateSemanticCustomColumnInput(body);
    assertMutation(projectId, headers, input);
    return response(request, await this.columns.create(input));
  }

  @Patch("semantic-custom-columns/:columnId")
  public async update(
    @Param("projectId") projectId: string,
    @Param("columnId") columnId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticCustomColumn>> {
    const input = internalUpdateSemanticCustomColumnInput(body);
    assertMutation(projectId, headers, input);
    return response(
      request,
      await this.columns.update(internalUuid(columnId, "columnId"), input)
    );
  }

  @Delete("semantic-custom-columns/:columnId")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(
    @Param("projectId") projectId: string,
    @Param("columnId") columnId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders
  ): Promise<void> {
    const input = internalDeleteSemanticCustomColumnInput(body);
    assertMutation(projectId, headers, input);
    await this.columns.delete(internalUuid(columnId, "columnId"), input);
  }

  @Put("keywords/:keywordId/custom-values/:columnId")
  public async setKeywordValue(
    @Param("projectId") projectId: string,
    @Param("keywordId") keywordId: string,
    @Param("columnId") columnId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticKeywordCustomValue>> {
    const input = internalSetSemanticKeywordCustomValueInput(body);
    assertMutation(projectId, headers, input);
    const data = await this.columns.setKeywordValue(
      internalUuid(keywordId, "keywordId"),
      internalUuid(columnId, "columnId"),
      input
    );
    return {
      data,
      meta: { requestId: request.id, version: data.version }
    };
  }

  @Delete("keywords/:keywordId/custom-values/:columnId")
  @HttpCode(HttpStatus.NO_CONTENT)
  public async deleteKeywordValue(
    @Param("projectId") projectId: string,
    @Param("keywordId") keywordId: string,
    @Param("columnId") columnId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders
  ): Promise<void> {
    const input = internalDeleteSemanticKeywordCustomValueInput(body);
    assertMutation(projectId, headers, input);
    await this.columns.deleteKeywordValue(
      internalUuid(keywordId, "keywordId"),
      internalUuid(columnId, "columnId"),
      input
    );
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
  data: SemanticCustomColumn
): ApiResponse<SemanticCustomColumn> {
  return {
    data,
    meta: { requestId: request.id, version: data.version }
  };
}
