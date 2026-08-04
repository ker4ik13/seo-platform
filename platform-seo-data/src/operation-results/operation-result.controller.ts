import {
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
  InternalCrawlOperationResultPage,
  InternalFrequencyOperationResult,
  InternalRankOperationResult
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { internalUuid } from "../internal/internal-command-context.js";
import {
  rankManifestRouteContext,
  type RankManifestInternalHeaders
} from "../rank-manifests/rank-manifest-route-context.js";
import {
  internalFrequencyOperationResultInput,
  operationResultCursor,
  operationResultLimit
} from "./operation-result-input.js";
import { OperationResultService } from "./operation-result.service.js";

@Controller("internal/v1/projects/:projectId/operation-results")
@UseGuards(PlatformApiGuard)
export class OperationResultController {
  public constructor(private readonly results: OperationResultService) {}

  @Post("frequency/:jobId")
  public async frequency(
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Headers() headers: RankManifestInternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalFrequencyOperationResult>> {
    const context = rankManifestRouteContext(projectId, headers);
    const canonicalJobId = internalUuid(jobId, "jobId");
    return response(
      request,
      await this.results.frequency(
        internalFrequencyOperationResultInput(
          body,
          context,
          canonicalJobId
        )
      )
    );
  }

  @Get("rank/:jobId")
  public async rank(
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Headers() headers: RankManifestInternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalRankOperationResult>> {
    const context = rankManifestRouteContext(projectId, headers);
    return response(
      request,
      await this.results.rank(context, internalUuid(jobId, "jobId"))
    );
  }

  @Get("crawl/:crawlId")
  public async crawl(
    @Param("projectId") projectId: string,
    @Param("crawlId") crawlId: string,
    @Query("limit") limit: unknown,
    @Query("cursor") cursor: unknown,
    @Headers() headers: RankManifestInternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalCrawlOperationResultPage>> {
    const context = rankManifestRouteContext(projectId, headers);
    return response(
      request,
      await this.results.crawl(
        context,
        internalUuid(crawlId, "crawlId"),
        operationResultLimit(limit),
        operationResultCursor(cursor)
      )
    );
  }
}

function response<Data>(request: FastifyRequest, data: Data): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
