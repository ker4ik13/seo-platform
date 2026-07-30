import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalRankHistoryCollection
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  rankManifestRouteContext,
  type RankManifestInternalHeaders
} from "../rank-manifests/rank-manifest-route-context.js";
import { RankHistoryService } from "./rank-history.service.js";
import { rankHistoryQuery } from "./rank-history-query.js";

@Controller("internal/v1/projects/:projectId/rank-history")
@UseGuards(PlatformApiGuard)
export class RankHistoryController {
  public constructor(private readonly history: RankHistoryService) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Query() query: unknown,
    @Headers() headers: RankManifestInternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalRankHistoryCollection>> {
    const context = rankManifestRouteContext(projectId, headers);
    return {
      data: await this.history.list({
        ...context,
        ...rankHistoryQuery(query)
      }),
      meta: { requestId: request.id }
    };
  }
}
