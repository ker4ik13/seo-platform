import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  TechnicalCrawlCollection,
  TechnicalCrawlSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCancelTechnicalCrawlInput,
  internalCreateTechnicalCrawlInput
} from "./crawl-input.js";
import { CrawlService } from "./crawl.service.js";

type HeadersRecord = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller(
  "internal/v1/workspaces/:workspaceId/projects/:projectId/crawls"
)
@UseGuards(PlatformApiGuard)
export class CrawlController {
  public constructor(private readonly crawls: CrawlService) {}

  @Get()
  public async list(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TechnicalCrawlCollection>> {
    const context = routeContext(workspaceId, projectId, headers);
    return response(
      request,
      await this.crawls.list(context.workspaceId, context.projectId)
    );
  }

  @Post()
  public async create(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TechnicalCrawlSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    const input = internalCreateTechnicalCrawlInput(body);
    assertInternalContext(input, context);
    return response(request, await this.crawls.create(input));
  }

  @Get(":crawlId")
  public async get(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("crawlId") crawlId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TechnicalCrawlSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    return response(
      request,
      await this.crawls.get(
        context.workspaceId,
        context.projectId,
        internalUuid(crawlId, "crawlId")
      )
    );
  }

  @Post(":crawlId/cancel")
  public async cancel(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("crawlId") crawlId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TechnicalCrawlSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    const input = internalCancelTechnicalCrawlInput(body);
    assertInternalContext(input, context);
    return response(
      request,
      await this.crawls.cancel(internalUuid(crawlId, "crawlId"), input)
    );
  }
}

function routeContext(
  workspaceId: string,
  projectId: string,
  headers: HeadersRecord
) {
  const context = internalCommandContext(headers);
  if (
    context.workspaceId !== internalUuid(workspaceId, "workspaceId") ||
    context.projectId !== internalUuid(projectId, "projectId")
  ) {
    throw new BadRequestException(
      "Route tenant context does not match trusted context"
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
