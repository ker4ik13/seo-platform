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
import type {
  ApiResponse,
  InternalRankExecutionGrantDecisionV1
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { assertUuid } from "../common/identifier.js";
import {
  issueRankExecutionGrantInput,
  requiredRankExecutionGrantHeaders
} from "./rank-execution-grant-input.js";
import {
  rankExecutionGrantActionPath,
  rankExecutionGrantControllerPath
} from "./rank-execution-grant-http.js";
import { RankExecutionGrantGuard } from "./rank-execution-grant.guard.js";
import { RankExecutionGrantService } from "./rank-execution-grant.service.js";

@Controller(rankExecutionGrantControllerPath)
@UseGuards(RankExecutionGrantGuard)
export class RankExecutionGrantController {
  public constructor(
    private readonly grants: RankExecutionGrantService
  ) {}

  @Post(rankExecutionGrantActionPath)
  @HttpCode(HttpStatus.CREATED)
  public async issue(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<InternalRankExecutionGrantDecisionV1>> {
    reply.header("Cache-Control", "no-store");
    const headers = requiredRankExecutionGrantHeaders(request);
    const input = issueRankExecutionGrantInput(body);
    if (
      assertUuid(workspaceId, "workspaceId") !== input.workspaceId ||
      assertUuid(projectId, "projectId") !== input.projectId ||
      headers.workspaceId !== input.workspaceId ||
      headers.projectId !== input.projectId ||
      headers.actorId !== input.actorId ||
      headers.requestId !== request.id
    ) {
      throw new BadRequestException(
        "Route, trusted headers and grant request do not match"
      );
    }
    const result = await this.grants.issue(
      input,
      headers.idempotencyKey,
      headers.requestId
    );
    reply.code(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return {
      data: result.decision,
      meta: { requestId: headers.requestId }
    };
  }
}
