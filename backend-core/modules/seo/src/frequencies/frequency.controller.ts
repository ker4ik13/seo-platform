import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalFrequencyKeyword,
  InternalFrequencyKeywords
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import {
  internalPersistFrequencySnapshotBatchInput,
  internalPersistFrequencySeasonalityBatchInput,
  internalPersistFrequencySnapshotsInput,
  internalResolveFrequencyKeywordsInput,
  internalResolveFrequencyKeywordInput
} from "./frequency-input.js";
import { FrequencyService } from "./frequency.service.js";

type HeadersRecord = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/projects/:projectId/frequencies")
@UseGuards(JobsApiGuard)
export class FrequencyController {
  public constructor(private readonly frequencies: FrequencyService) {}

  @Post("resolve")
  public async resolve(
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalFrequencyKeyword>> {
    const context = routeContext(projectId, headers);
    const input = internalResolveFrequencyKeywordInput(body);
    assertInternalContext(input, context);
    return response(request, await this.frequencies.resolve(input));
  }

  @Post("resolve-batch")
  public async resolveBatch(
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalFrequencyKeywords>> {
    const context = routeContext(projectId, headers);
    const input = internalResolveFrequencyKeywordsInput(body);
    assertInternalContext(input, context);
    return response(request, await this.frequencies.resolveBatch(input));
  }

  @Post("snapshots")
  public async persist(
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly created: number }>> {
    const context = routeContext(projectId, headers);
    const input = internalPersistFrequencySnapshotsInput(body);
    assertInternalContext(input, context);
    return response(request, await this.frequencies.persist(input));
  }

  @Post("snapshots-batch")
  public async persistBatch(
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly created: number }>> {
    const context = routeContext(projectId, headers);
    const input = internalPersistFrequencySnapshotBatchInput(body);
    assertInternalContext(input, context);
    return response(request, await this.frequencies.persistBatch(input));
  }

  @Post("seasonality-batch")
  public async persistSeasonalityBatch(
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly created: number }>> {
    const context = routeContext(projectId, headers);
    const input = internalPersistFrequencySeasonalityBatchInput(body);
    assertInternalContext(input, context);
    return response(
      request,
      await this.frequencies.persistSeasonalityBatch(input)
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
