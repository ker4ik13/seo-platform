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
  ClusteringProposalApplyResult,
  ClusteringProposalSummary,
  InternalClusteringKeywords,
  InternalClusteringProposalResult
} from "@seo-platform/contracts";
import { operationResultDefaultPageSize } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalApplyClusteringProposalInput,
  internalClusteringProposalResultInput,
  internalPersistClusteringProposalInput,
  internalRejectClusteringProposalInput,
  internalResolveClusteringKeywordsInput
} from "./clustering-proposal-input.js";
import { ClusteringProposalService } from "./clustering-proposal.service.js";

type HeadersRecord = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/projects/:projectId/clustering-proposals")
@UseGuards(JobsApiGuard)
export class ClusteringProposalCommandController {
  public constructor(private readonly proposals: ClusteringProposalService) {}

  @Post("resolve-batch")
  public async resolveBatch(
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalClusteringKeywords>> {
    const context = routeContext(projectId, headers);
    const input = internalResolveClusteringKeywordsInput(body);
    assertInternalContext(input, context);
    return response(request, await this.proposals.resolveBatch(input));
  }

  @Post()
  public async persist(
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ClusteringProposalSummary>> {
    const context = routeContext(projectId, headers);
    const input = internalPersistClusteringProposalInput(body);
    assertInternalContext(input, context);
    return response(request, await this.proposals.persist(input));
  }
}

@Controller("internal/v1/projects/:projectId/clustering-proposals")
@UseGuards(PlatformApiGuard)
export class ClusteringProposalReadController {
  public constructor(private readonly proposals: ClusteringProposalService) {}

  @Get(":jobId/result")
  public async result(
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Query("limit") limitValue: unknown,
    @Query("cursor") cursorValue: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalClusteringProposalResult>> {
    const context = routeContext(projectId, headers);
    const limit = limitValue === undefined
      ? operationResultDefaultPageSize
      : queryInteger(limitValue, "limit");
    const cursor = cursorValue === undefined
      ? undefined
      : queryInteger(cursorValue, "cursor");
    return response(request, await this.proposals.result(
      internalClusteringProposalResultInput({
        ...context,
        jobId: internalUuid(jobId, "jobId"),
        limit,
        ...(cursor === undefined ? {} : { cursor })
      })
    ));
  }

  @Post(":jobId/apply")
  public async apply(
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ClusteringProposalApplyResult>> {
    const context = routeContext(projectId, headers);
    const input = internalApplyClusteringProposalInput(body);
    assertInternalContext(input, context);
    if (input.jobId !== internalUuid(jobId, "jobId")) {
      throw new BadRequestException("Route clustering job does not match trusted command");
    }
    const result = await this.proposals.apply(input);
    return response(request, result, result.proposal.version);
  }

  @Post(":jobId/reject")
  public async reject(
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ClusteringProposalSummary>> {
    const context = routeContext(projectId, headers);
    const input = internalRejectClusteringProposalInput(body);
    assertInternalContext(input, context);
    if (input.jobId !== internalUuid(jobId, "jobId")) {
      throw new BadRequestException("Route clustering job does not match trusted command");
    }
    const result = await this.proposals.reject(input);
    return response(request, result, result.version);
  }
}

function routeContext(projectId: string, headers: HeadersRecord) {
  const context = internalCommandContext(headers);
  if (context.projectId !== internalUuid(projectId, "projectId")) {
    throw new BadRequestException("Route project does not match trusted context");
  }
  return context;
}

function queryInteger(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,4})$/u.test(value)) {
    throw new BadRequestException(`Invalid clustering proposal ${field}`);
  }
  return Number(value);
}

function response<Data>(request: FastifyRequest, data: Data, version?: number): ApiResponse<Data> {
  return {
    data,
    meta: { requestId: request.id, ...(version === undefined ? {} : { version }) }
  };
}
