import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type { ApiResponse, RankEstimate } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { IntegrationCredentialApiGuard } from "../integrations/integration-credential-api.guard.js";
import {
  internalCreateRankEstimateInput,
  rankEstimateIdempotencyKey
} from "./rank-estimate-input.js";
import { RankEstimateService } from "./rank-estimate.service.js";

@Controller(
  "internal/v1/workspaces/:workspaceId/projects/:projectId/rank-estimates"
)
@UseGuards(IntegrationCredentialApiGuard)
export class RankEstimateController {
  public constructor(private readonly estimates: RankEstimateService) {}

  @Post()
  public async create(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Headers("idempotency-key") idempotencyKey: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<RankEstimate>> {
    const context = internalCommandContext(headers);
    assertInternalContext(
      {
        workspaceId: internalUuid(workspaceId, "workspaceId"),
        projectId: internalUuid(projectId, "projectId"),
        actorId: context.actorId
      },
      context
    );
    const input = internalCreateRankEstimateInput(body);
    assertInternalContext(input, context);
    return {
      data: await this.estimates.create(
        input,
        rankEstimateIdempotencyKey(idempotencyKey)
      ),
      meta: { requestId: request.id }
    };
  }
}
