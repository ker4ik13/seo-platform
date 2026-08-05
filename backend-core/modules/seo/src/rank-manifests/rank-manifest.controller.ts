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
  InternalRankManifestChunk,
  InternalRankManifestSeal
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { RankExecutionApiGuard } from "../internal/rank-execution-api.guard.js";
import {
  assertInternalContext,
} from "../internal/internal-command-context.js";
import {
  internalGetRankManifestChunkInput,
  internalRankManifestChunkQuery,
  internalSealRankManifestInput
} from "./rank-manifest-input.js";
import {
  rankManifestRouteContext,
  type RankManifestInternalHeaders
} from "./rank-manifest-route-context.js";
import { RankManifestService } from "./rank-manifest.service.js";

@Controller("internal/v1/projects/:projectId/rank-manifests")
@UseGuards(RankExecutionApiGuard)
export class RankManifestController {
  public constructor(
    private readonly rankManifests: RankManifestService
  ) {}

  @Post()
  public async seal(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: RankManifestInternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalRankManifestSeal>> {
    const input = internalSealRankManifestInput(body);
    const context = rankManifestRouteContext(projectId, headers);
    assertInternalContext(input, context);
    return response(request, await this.rankManifests.seal(input));
  }

  @Get(":manifestId/chunks/:chunkIndex")
  public async getChunk(
    @Param("projectId") projectId: string,
    @Param("manifestId") manifestId: string,
    @Param("chunkIndex") chunkIndex: string,
    @Query() query: unknown,
    @Headers() headers: RankManifestInternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalRankManifestChunk>> {
    const context = rankManifestRouteContext(projectId, headers);
    const { jobId } = internalRankManifestChunkQuery(query);
    const input = internalGetRankManifestChunkInput({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      jobId,
      manifestId,
      chunkIndex
    });
    return response(request, await this.rankManifests.getChunk(input));
  }
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
