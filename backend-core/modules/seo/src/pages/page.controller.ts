import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  ProjectPageCollection,
  ProjectPageSummary
} from "@seo-platform/contracts";
import { parseProjectPageStatisticsQuery, parseProjectPagePanelQuery, type ProjectPageStatisticsCollection, type ProjectPagePanel } from "@seo-platform/contracts";
import { PageInsightsService } from "./page-insights.service.js";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid,
  type InternalCommandContext
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalChangeProjectPageStatusInput,
  internalCreateProjectPageInput,
  internalUpdateProjectPageInput,
  projectPageListQuery
} from "./page-input.js";
import { PageService } from "./page.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/projects/:projectId/pages")
@UseGuards(PlatformApiGuard)
export class PageController {
  public constructor(private readonly pages: PageService, private readonly insights: PageInsightsService) {}

  @Get("rank-statistics")
  public async statistics(@Param("projectId") projectId: string, @Query() query: unknown, @Headers() headers: InternalHeaders, @Req() request: FastifyRequest): Promise<ApiResponse<ProjectPageStatisticsCollection>> {
    const context = routeContext(projectId, headers);
    return response(request, await this.insights.statistics(context, parseRead(parseProjectPageStatisticsQuery, query)));
  }

  @Get("by-keyword/:keywordId")
  public async targetPage(@Param("projectId") projectId: string, @Param("keywordId") keywordId: string, @Headers() headers: InternalHeaders, @Req() request: FastifyRequest): Promise<ApiResponse<{ page?: ProjectPageSummary }>> {
    const context = routeContext(projectId, headers);
    const pageId = await this.insights.targetPageId(context, internalUuid(keywordId, "keywordId"));
    return response(request, pageId ? { page: await this.pages.get(context.workspaceId, context.projectId, pageId) } : {});
  }

  @Get(":pageId/panel")
  public async panel(@Param("projectId") projectId: string, @Param("pageId") pageId: string, @Query() query: unknown, @Headers() headers: InternalHeaders, @Req() request: FastifyRequest): Promise<ApiResponse<ProjectPagePanel>> {
    const context = routeContext(projectId, headers);
    return response(request, await this.insights.panel(context, internalUuid(pageId, "pageId"), parseRead(parseProjectPagePanelQuery, query)));
  }

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Query() query: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectPageCollection>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.pages.list(
        context.workspaceId,
        context.projectId,
        projectPageListQuery(query)
      )
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectPageSummary>> {
    const input = internalCreateProjectPageInput(body);
    assertMutation(projectId, headers, input);
    return response(request, await this.pages.create(input));
  }

  @Get(":pageId")
  public async get(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectPageSummary>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.pages.get(
        context.workspaceId,
        context.projectId,
        internalUuid(pageId, "pageId")
      )
    );
  }

  @Patch(":pageId")
  public async update(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectPageSummary>> {
    const input = internalUpdateProjectPageInput(body);
    assertMutation(projectId, headers, input);
    return response(
      request,
      await this.pages.update(internalUuid(pageId, "pageId"), input)
    );
  }

  @Post(":pageId/archive")
  @HttpCode(HttpStatus.OK)
  public async archive(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectPageSummary>> {
    const input = internalChangeProjectPageStatusInput(body);
    assertMutation(projectId, headers, input);
    return response(
      request,
      await this.pages.archive(internalUuid(pageId, "pageId"), input)
    );
  }

  @Post(":pageId/restore")
  @HttpCode(HttpStatus.OK)
  public async restore(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectPageSummary>> {
    const input = internalChangeProjectPageStatusInput(body);
    assertMutation(projectId, headers, input);
    return response(
      request,
      await this.pages.restore(internalUuid(pageId, "pageId"), input)
    );
  }
}

function routeContext(
  routeProjectId: string,
  headers: InternalHeaders
): InternalCommandContext {
  const context = internalCommandContext(headers);
  if (internalUuid(routeProjectId, "projectId") !== context.projectId) {
    throw new BadRequestException(
      "Route project identifier does not match trusted context"
    );
  }
  return context;
}

function parseRead<T>(parser: (value: unknown) => T, value: unknown): T {
  try { return parser(value); } catch { throw new BadRequestException("Invalid page read query"); }
}

function assertMutation(
  routeProjectId: string,
  headers: InternalHeaders,
  input: InternalCommandContext
): void {
  assertInternalContext(input, routeContext(routeProjectId, headers));
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
