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
  ApiResponse,
  InternalAiAnswerHistoryCollection,
  InternalAiAnswerKeywords,
  SemanticAiAnswerDetail
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalPersistAiAnswerSnapshotBatchInput,
  internalResolveAiAnswerKeywordsInput
} from "./ai-answer-input.js";
import { aiAnswerHistoryQuery } from "./ai-answer-history-query.js";
import { AiAnswerService } from "./ai-answer.service.js";

type HeadersRecord = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/projects/:projectId/ai-answers")
@UseGuards(JobsApiGuard)
export class AiAnswerCommandController {
  public constructor(private readonly answers: AiAnswerService) {}

  @Post("resolve-batch")
  public async resolveBatch(
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalAiAnswerKeywords>> {
    const context = routeContext(projectId, headers);
    const input = internalResolveAiAnswerKeywordsInput(body);
    assertInternalContext(input, context);
    return response(request, await this.answers.resolveBatch(input));
  }

  @Post("snapshots-batch")
  public async persistBatch(
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly created: number }>> {
    const context = routeContext(projectId, headers);
    const input = internalPersistAiAnswerSnapshotBatchInput(body);
    assertInternalContext(input, context);
    return response(request, await this.answers.persistBatch(input));
  }
}

@Controller("internal/v1/projects/:projectId/keywords/:keywordId/ai-answers")
@UseGuards(PlatformApiGuard)
export class AiAnswerReadController {
  public constructor(private readonly answers: AiAnswerService) {}

  @Get("history")
  public async history(
    @Param("projectId") projectId: string,
    @Param("keywordId") keywordId: string,
    @Query() query: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalAiAnswerHistoryCollection>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.answers.history({
        ...context,
        keywordId: internalUuid(keywordId, "keywordId"),
        ...aiAnswerHistoryQuery(query)
      })
    );
  }

  @Get()
  public async latest(
    @Param("projectId") projectId: string,
    @Param("keywordId") keywordId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticAiAnswerDetail[]>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.answers.latest(
        context.workspaceId,
        context.projectId,
        internalUuid(keywordId, "keywordId")
      )
    );
  }
}

function routeContext(projectId: string, headers: HeadersRecord) {
  const context = internalCommandContext(headers);
  if (context.projectId !== internalUuid(projectId, "projectId")) {
    throw new BadRequestException("Route project does not match trusted context");
  }
  return context;
}

function response<Data>(request: FastifyRequest, data: Data): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
