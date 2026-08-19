import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  AiAnswerCollectionSummary,
  ApiResponse,
  InternalAiAnswerOperationScope
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCancelAiAnswerCollectionInput,
  internalCreateAiAnswerCollectionInput,
  aiAnswerResultCursor,
  aiAnswerResultPageLimit
} from "./ai-answer-collection-input.js";
import { AiAnswerCollectionService } from "./ai-answer-collection.service.js";

type HeadersRecord = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/workspaces/:workspaceId/projects/:projectId/ai-answer-collections")
@UseGuards(PlatformApiGuard)
export class AiAnswerCollectionController {
  public constructor(private readonly collections: AiAnswerCollectionService) {}

  @Get()
  public async list(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly collections: readonly AiAnswerCollectionSummary[] }>> {
    const context = routeContext(workspaceId, projectId, headers);
    return response(request, {
      collections: await this.collections.list(context.workspaceId, context.projectId)
    });
  }

  @Post()
  public async create(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<AiAnswerCollectionSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    const input = internalCreateAiAnswerCollectionInput(body);
    assertInternalContext(input, context);
    return response(request, await this.collections.create(input));
  }

  @Get(":jobId")
  public async get(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<AiAnswerCollectionSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    return response(request, await this.collections.get(
      context.workspaceId,
      context.projectId,
      internalUuid(jobId, "jobId")
    ));
  }

  @Post(":jobId/cancel")
  public async cancel(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<AiAnswerCollectionSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    const input = internalCancelAiAnswerCollectionInput(body);
    assertInternalContext(input, context);
    return response(request, await this.collections.cancel(
      internalUuid(jobId, "jobId"),
      input
    ));
  }

  @Get(":jobId/result-scope")
  public async resultScope(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Query("limit") limit: unknown,
    @Query("cursor") cursor: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalAiAnswerOperationScope>> {
    const context = routeContext(workspaceId, projectId, headers);
    return response(request, await this.collections.resultScope(
      context.workspaceId,
      context.projectId,
      internalUuid(jobId, "jobId"),
      aiAnswerResultPageLimit(limit),
      aiAnswerResultCursor(cursor)
    ));
  }
}

function routeContext(workspaceId: string, projectId: string, headers: HeadersRecord) {
  const context = internalCommandContext(headers);
  if (
    context.workspaceId !== internalUuid(workspaceId, "workspaceId") ||
    context.projectId !== internalUuid(projectId, "projectId")
  ) throw new BadRequestException("Route tenant context does not match trusted context");
  return context;
}

function response<Data>(request: FastifyRequest, data: Data): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
