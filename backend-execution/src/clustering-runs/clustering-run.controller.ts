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
import type { ApiResponse, ClusteringRunSummary } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCancelClusteringRunInput,
  internalCreateClusteringRunInput
} from "./clustering-run-input.js";
import { ClusteringRunService } from "./clustering-run.service.js";

type HeadersRecord = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/workspaces/:workspaceId/projects/:projectId/clustering-runs")
@UseGuards(PlatformApiGuard)
export class ClusteringRunController {
  public constructor(private readonly runs: ClusteringRunService) {}

  @Get()
  public async list(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly runs: readonly ClusteringRunSummary[] }>> {
    const context = routeContext(workspaceId, projectId, headers);
    return response(request, {
      runs: await this.runs.list(context.workspaceId, context.projectId)
    });
  }

  @Post()
  public async create(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ClusteringRunSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    const input = internalCreateClusteringRunInput(body);
    assertInternalContext(input, context);
    const result = await this.runs.create(input);
    return response(request, result, result.version);
  }

  @Get(":jobId")
  public async get(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ClusteringRunSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    return response(request, await this.runs.get(
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
  ): Promise<ApiResponse<ClusteringRunSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    const input = internalCancelClusteringRunInput(body);
    assertInternalContext(input, context);
    const result = await this.runs.cancel(internalUuid(jobId, "jobId"), input);
    return response(request, result, result.version);
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

function response<Data>(request: FastifyRequest, data: Data, version?: number): ApiResponse<Data> {
  return {
    data,
    meta: { requestId: request.id, ...(version === undefined ? {} : { version }) }
  };
}
