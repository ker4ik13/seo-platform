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
  InternalRankChunkIngestReceipt
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { RankResultApiGuard } from "../internal/rank-result-api.guard.js";
import {
  rankManifestRouteContext,
  type RankManifestInternalHeaders
} from "../rank-manifests/rank-manifest-route-context.js";
import {
  internalIngestRankChunkInput,
  resultChunkIndex
} from "./rank-result-input.js";
import { RankResultService } from "./rank-result.service.js";

@Controller("internal/v1/projects/:projectId/rank-manifests")
@UseGuards(RankResultApiGuard)
export class RankResultController {
  public constructor(private readonly rankResults: RankResultService) {}

  @Post(":manifestId/chunks/:chunkIndex/results")
  public async ingest(
    @Param("projectId") projectId: string,
    @Param("manifestId") manifestId: string,
    @Param("chunkIndex") chunkIndex: string,
    @Body() body: unknown,
    @Headers() headers: RankManifestInternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalRankChunkIngestReceipt>> {
    const input = internalIngestRankChunkInput(body);
    const context = rankManifestRouteContext(projectId, headers);
    assertInternalContext(input, context);
    if (
      internalUuid(manifestId, "manifestId") !== input.manifestId ||
      resultChunkIndex(chunkIndex) !== input.chunkIndex
    ) {
      throw new BadRequestException(
        "Rank result route does not match the command"
      );
    }
    return {
      data: await this.rankResults.ingest(input),
      meta: { requestId: request.id }
    };
  }
}
