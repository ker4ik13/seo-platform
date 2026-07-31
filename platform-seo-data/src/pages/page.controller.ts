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
  public constructor(private readonly pages: PageService) {}

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
