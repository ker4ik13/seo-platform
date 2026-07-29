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
  InternalRankCheckFinalizationReceipt
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { RankExecutionApiGuard } from "../internal/rank-execution-api.guard.js";
import {
  assertInternalContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { internalFinalizeRankCheckInput } from "./rank-finalization-input.js";
import { RankFinalizationService } from "./rank-finalization.service.js";
import {
  rankManifestRouteContext,
  type RankManifestInternalHeaders
} from "./rank-manifest-route-context.js";

@Controller(
  "internal/v1/projects/:projectId/rank-manifests/:manifestId"
)
@UseGuards(RankExecutionApiGuard)
export class RankFinalizationController {
  public constructor(
    private readonly rankFinalization: RankFinalizationService
  ) {}

  @Post("finalize")
  public async finalize(
    @Param("projectId") projectId: string,
    @Param("manifestId") manifestId: string,
    @Body() body: unknown,
    @Headers() headers: RankManifestInternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalRankCheckFinalizationReceipt>> {
    const input = internalFinalizeRankCheckInput(body);
    const context = rankManifestRouteContext(projectId, headers);
    assertInternalContext(input, context);
    if (internalUuid(manifestId, "manifestId") !== input.manifestId) {
      throw new BadRequestException(
        "Route manifest identifier does not match the command"
      );
    }
    return {
      data: await this.rankFinalization.finalize(input),
      meta: { requestId: request.id }
    };
  }
}
