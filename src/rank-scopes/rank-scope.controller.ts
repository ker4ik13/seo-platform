import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalRankEstimateScope
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { InternalApiGuard } from "../internal/internal-api.guard.js";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { internalRankEstimateScopeInput } from "./rank-scope-input.js";
import { RankScopeService } from "./rank-scope.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/projects/:projectId/rank-estimate-scopes")
@UseGuards(InternalApiGuard)
export class RankScopeController {
  public constructor(private readonly rankScopes: RankScopeService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  public async calculate(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalRankEstimateScope>> {
    const input = internalRankEstimateScopeInput(body);
    const trustedContext = internalCommandContext(headers);
    if (
      internalUuid(projectId, "projectId") !== trustedContext.projectId
    ) {
      throw new BadRequestException(
        "Route project identifier does not match trusted context"
      );
    }
    assertInternalContext(input, trustedContext);
    return {
      data: await this.rankScopes.calculate(input),
      meta: { requestId: request.id }
    };
  }
}
