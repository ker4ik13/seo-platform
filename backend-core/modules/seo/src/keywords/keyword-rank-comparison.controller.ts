import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { parseSemanticRankComparisonInput } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { internalCommandContext, internalUuid } from "../internal/internal-command-context.js";
import { KeywordRankComparisonService } from "./keyword-rank-comparison.service.js";

@Controller("internal/v1/projects/:projectId/keyword-ranks")
@UseGuards(PlatformApiGuard)
export class KeywordRankComparisonController {
  constructor(private readonly ranks: KeywordRankComparisonService) {}

  @Get("dimensions")
  async catalog(@Param("projectId") projectId: string, @Headers() headers: Readonly<Record<string, string | string[] | undefined>>, @Req() request: FastifyRequest) {
    return { data: await this.ranks.catalog(scope(projectId, headers)), meta: { requestId: request.id } };
  }

  @Post("comparison")
  @HttpCode(200)
  async compare(@Param("projectId") projectId: string, @Headers() headers: Readonly<Record<string, string | string[] | undefined>>, @Body() body: unknown, @Req() request: FastifyRequest) {
    const context = scope(projectId, headers);
    let input;
    try { input = parseSemanticRankComparisonInput(body); } catch { throw new BadRequestException("Invalid comparison input"); }
    return { data: await this.ranks.compare(context, input), meta: { requestId: request.id } };
  }
}
function scope(projectId: string, headers: Readonly<Record<string, string | string[] | undefined>>) {
  const context = internalCommandContext(headers);
  if (internalUuid(projectId, "projectId") !== context.projectId) throw new BadRequestException("Route project does not match trusted context");
  return context;
}
