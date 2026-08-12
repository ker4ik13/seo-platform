import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  ApiResponse,
  SemanticCustomColumn,
  SemanticKeywordGroup,
  SemanticKeywordListItem
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import { KeywordGroupService } from "../keyword-groups/keyword-group.service.js";
import { keywordListQuery } from "../keywords/keyword-query.js";
import { KeywordService } from "../keywords/keyword.service.js";
import { SemanticCustomColumnService } from "../semantic-custom-columns/semantic-custom-column.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/projects/:projectId/semantic-exports")
@UseGuards(JobsApiGuard)
export class SemanticExportReadController {
  public constructor(
    private readonly keywords: KeywordService,
    private readonly groups: KeywordGroupService,
    private readonly columns: SemanticCustomColumnService
  ) {}

  @Get("keywords")
  public async listKeywords(
    @Param("projectId") projectId: string,
    @Query() query: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const context = routeContext(projectId, headers);
    return this.keywords.list(
      context.workspaceId,
      context.projectId,
      keywordListQuery(query),
      request.id
    );
  }

  @Get("keyword-groups")
  public async listKeywordGroups(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticKeywordGroup[]>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.groups.list(context.workspaceId, context.projectId)
    );
  }

  @Get("custom-columns")
  public async listCustomColumns(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticCustomColumn[]>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.columns.list(context.workspaceId, context.projectId)
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

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
