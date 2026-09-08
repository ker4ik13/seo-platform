import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import {
  internalSettleRankExecutionGrantInput,
  type ApiResponse,
  type InternalRankExecutionGrantSettlementResultV1
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { assertUuid } from "../common/identifier.js";
import {
  requiredRankExecutionGrantHeaders
} from "./rank-execution-grant-input.js";
import {
  rankExecutionGrantControllerPath,
  rankExecutionGrantSettlementActionPath
} from "./rank-execution-grant-http.js";
import { RankExecutionGrantSettlementGuard } from "./rank-execution-grant-settlement.guard.js";
import { RankExecutionGrantSettlementService } from "./rank-execution-grant-settlement.service.js";

@Controller(rankExecutionGrantControllerPath)
@UseGuards(RankExecutionGrantSettlementGuard)
export class RankExecutionGrantSettlementController {
  public constructor(
    private readonly settlements: RankExecutionGrantSettlementService
  ) {}

  @Post(rankExecutionGrantSettlementActionPath)
  @HttpCode(HttpStatus.OK)
  public async capture(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("grantId") grantId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<InternalRankExecutionGrantSettlementResultV1>> {
    reply.header("Cache-Control", "no-store");
    const headers = requiredRankExecutionGrantHeaders(request);
    let action: "HOLD" | "CAPTURE" | "RELEASE";
    try {
      action = internalSettleRankExecutionGrantInput(body).action;
    } catch {
      throw new BadRequestException(
        "Invalid rank billing settlement request"
      );
    }
    const trustedWorkspaceId = assertUuid(workspaceId, "workspaceId");
    const trustedProjectId = assertUuid(projectId, "projectId");
    const trustedGrantId = assertUuid(grantId, "grantId");
    if (
      trustedWorkspaceId !== headers.workspaceId ||
      trustedProjectId !== headers.projectId ||
      headers.requestId !== request.id
    ) {
      throw new BadRequestException(
        "Route and trusted settlement headers do not match"
      );
    }
    const scope = {
      workspaceId: trustedWorkspaceId,
      projectId: trustedProjectId,
      actorId: headers.actorId,
      grantId: trustedGrantId
    };
    return {
      data: action === "HOLD"
        ? await this.settlements.hold(scope)
        : action === "RELEASE" ? await this.settlements.release(scope)
        : await this.settlements.capture(scope),
      meta: { requestId: headers.requestId }
    };
  }
}
