import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  RankJobSummary
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { IntegrationCredentialApiGuard } from "../integrations/integration-credential-api.guard.js";
import {
  internalCancelRankJobInput,
  internalCreateRankRunInput,
  internalRankJobQuery,
  rankRunIdempotencyKey
} from "./rank-run-input.js";
import { RankRunService } from "./rank-run.service.js";

@Controller("internal/v1/workspaces/:workspaceId/projects/:projectId")
@UseGuards(IntegrationCredentialApiGuard)
export class RankRunController {
  public constructor(private readonly rankRuns: RankRunService) {}

  @Get("rank-runs")
  public async list(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly jobs: readonly RankJobSummary[] }>> {
    const context = internalCommandContext(headers);
    assertPathContext(workspaceId, projectId, context);
    return {
      data: {
        jobs: await this.rankRuns.list(context.workspaceId, context.projectId)
      },
      meta: { requestId: request.id }
    };
  }

  @Post("rank-runs")
  @HttpCode(HttpStatus.ACCEPTED)
  public async create(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Headers("idempotency-key") idempotencyKey: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) response: FastifyReply
  ): Promise<ApiResponse<RankJobSummary>> {
    const context = internalCommandContext(headers);
    assertPathContext(workspaceId, projectId, context);
    const input = internalCreateRankRunInput(body);
    assertInternalContext(input, context);
    const job = await this.rankRuns.create(
      input,
      rankRunIdempotencyKey(idempotencyKey),
      request.id
    );
    response.header(
      "Location",
      `/internal/v1/workspaces/${job.workspaceId}/projects/${job.projectId}/jobs/${job.id}`
    );
    return { data: job, meta: { requestId: request.id } };
  }

  @Get("jobs/:jobId")
  public async get(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<RankJobSummary>> {
    const context = internalCommandContext(headers);
    assertPathContext(workspaceId, projectId, context);
    const input = internalRankJobQuery({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      actorId: context.actorId,
      jobId: internalUuid(jobId, "jobId")
    });
    return {
      data: await this.rankRuns.get(input),
      meta: { requestId: request.id }
    };
  }

  @Post("jobs/:jobId/cancel")
  public async cancel(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<RankJobSummary>> {
    const context = internalCommandContext(headers);
    assertPathContext(workspaceId, projectId, context);
    const input = internalCancelRankJobInput(body);
    assertInternalContext(input, context);
    if (internalUuid(jobId, "jobId") !== input.jobId) {
      throw new BadRequestException(
        "Route Job identifier does not match the command"
      );
    }
    return {
      data: await this.rankRuns.cancel(input),
      meta: { requestId: request.id }
    };
  }
}

function assertPathContext(
  workspaceId: string,
  projectId: string,
  context: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actorId: string;
  }
): void {
  assertInternalContext(
    {
      workspaceId: internalUuid(workspaceId, "workspaceId"),
      projectId: internalUuid(projectId, "projectId"),
      actorId: context.actorId
    },
    context
  );
}
