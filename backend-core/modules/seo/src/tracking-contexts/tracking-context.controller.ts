import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  ApiResponse,
  TrackingContextCollection,
  TrackingContextKeywordAssignmentItem,
  TrackingContextKeywordAssignmentState,
  TrackingContextKeywordReplacementResult,
  TrackingContextSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid,
  type InternalCommandContext
} from "../internal/internal-command-context.js";
import {
  internalChangeTrackingContextKeywordInput,
  internalChangeTrackingContextStatusInput,
  internalCreateTrackingContextInput,
  internalMaterializeTrackingContextInput,
  internalReplaceTrackingContextKeywordsInput,
  internalUpdateTrackingContextInput,
  trackingContextKeywordQuery
} from "./tracking-context-input.js";
import { TrackingContextService } from "./tracking-context.service.js";

@Controller("internal/v1/projects/:projectId/tracking-contexts")
@UseGuards(PlatformApiGuard)
export class TrackingContextController {
  public constructor(
    private readonly trackingContexts: TrackingContextService
  ) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TrackingContextCollection>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.trackingContexts.list(
        context.workspaceId,
        context.projectId
      )
    );
  }

  @Post()
  public async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TrackingContextSummary>> {
    const input = internalCreateTrackingContextInput(body);
    assertMutation(projectId, headers, input);
    return response(request, await this.trackingContexts.create(input));
  }

  @Get(":contextId")
  public async get(
    @Param("projectId") projectId: string,
    @Param("contextId") contextId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TrackingContextSummary>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.trackingContexts.get(
        context.workspaceId,
        context.projectId,
        internalUuid(contextId, "contextId")
      )
    );
  }

  @Patch(":contextId")
  public async update(
    @Param("projectId") projectId: string,
    @Param("contextId") contextId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TrackingContextSummary>> {
    const input = internalUpdateTrackingContextInput(body);
    assertMutation(projectId, headers, input);
    return response(
      request,
      await this.trackingContexts.update(
        internalUuid(contextId, "contextId"),
        input
      )
    );
  }

  @Post(":contextId/archive")
  @HttpCode(200)
  public async archive(
    @Param("projectId") projectId: string,
    @Param("contextId") contextId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TrackingContextSummary>> {
    const input = internalChangeTrackingContextStatusInput(body);
    assertMutation(projectId, headers, input);
    return response(
      request,
      await this.trackingContexts.archive(
        internalUuid(contextId, "contextId"),
        input
      )
    );
  }

  @Post(":contextId/materialize")
  @HttpCode(200)
  public async materialize(
    @Param("projectId") projectId: string,
    @Param("contextId") contextId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TrackingContextKeywordReplacementResult>> {
    const input = internalMaterializeTrackingContextInput(body);
    assertKeywordReplacement(projectId, contextId, headers, input);
    return response(
      request,
      await this.trackingContexts.materialize(input)
    );
  }

  @Post(":contextId/restore")
  @HttpCode(200)
  public async restore(
    @Param("projectId") projectId: string,
    @Param("contextId") contextId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TrackingContextSummary>> {
    const input = internalChangeTrackingContextStatusInput(body);
    assertMutation(projectId, headers, input);
    return response(
      request,
      await this.trackingContexts.restore(
        internalUuid(contextId, "contextId"),
        input
      )
    );
  }

  @Get(":contextId/keywords")
  public async listKeywords(
    @Param("projectId") projectId: string,
    @Param("contextId") contextId: string,
    @Query() query: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<
    ApiCollectionResponse<TrackingContextKeywordAssignmentItem>
  > {
    const context = routeContext(projectId, headers);
    return this.trackingContexts.listKeywords(
      context.workspaceId,
      context.projectId,
      internalUuid(contextId, "contextId"),
      trackingContextKeywordQuery(query),
      request.id
    );
  }

  @Put(":contextId/keywords")
  @HttpCode(200)
  public async replaceKeywords(
    @Param("projectId") projectId: string,
    @Param("contextId") contextId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TrackingContextKeywordReplacementResult>> {
    const input = internalReplaceTrackingContextKeywordsInput(body);
    assertKeywordReplacement(projectId, contextId, headers, input);
    return response(
      request,
      await this.trackingContexts.replaceKeywords(input)
    );
  }

  @Put(":contextId/keywords/:keywordId")
  @HttpCode(200)
  public async assignKeyword(
    @Param("projectId") projectId: string,
    @Param("contextId") contextId: string,
    @Param("keywordId") keywordId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TrackingContextKeywordAssignmentState>> {
    const input = internalChangeTrackingContextKeywordInput(body);
    assertKeywordMutation(
      projectId,
      contextId,
      keywordId,
      headers,
      input
    );
    return response(
      request,
      await this.trackingContexts.assignKeyword(input)
    );
  }

  @Delete(":contextId/keywords/:keywordId")
  @HttpCode(200)
  public async removeKeyword(
    @Param("projectId") projectId: string,
    @Param("contextId") contextId: string,
    @Param("keywordId") keywordId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<TrackingContextKeywordAssignmentState>> {
    const input = internalChangeTrackingContextKeywordInput(body);
    assertKeywordMutation(
      projectId,
      contextId,
      keywordId,
      headers,
      input
    );
    return response(
      request,
      await this.trackingContexts.removeKeyword(input)
    );
  }
}

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

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
  const context = routeContext(routeProjectId, headers);
  assertInternalContext(input, context);
}

function assertKeywordMutation(
  routeProjectId: string,
  routeContextId: string,
  routeKeywordId: string,
  headers: InternalHeaders,
  input: InternalCommandContext & {
    readonly contextId: string;
    readonly keywordId: string;
  }
): void {
  assertMutation(routeProjectId, headers, input);
  if (
    internalUuid(routeContextId, "contextId") !== input.contextId ||
    internalUuid(routeKeywordId, "keywordId") !== input.keywordId
  ) {
    throw new BadRequestException(
      "Route identifiers do not match the command"
    );
  }
}

function assertKeywordReplacement(
  routeProjectId: string,
  routeContextId: string,
  headers: InternalHeaders,
  input: InternalCommandContext & { readonly contextId: string }
): void {
  assertMutation(routeProjectId, headers, input);
  if (internalUuid(routeContextId, "contextId") !== input.contextId) {
    throw new BadRequestException(
      "Route context identifier does not match the command"
    );
  }
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
