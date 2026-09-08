import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { parseSemanticRankComparisonInput } from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { internalCommandContext, internalUuid } from "../internal/internal-command-context.js";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import { KeywordRankComparisonService } from "../keywords/keyword-rank-comparison.service.js";
type HeadersMap = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/projects/:projectId/semantic-exports")
@UseGuards(JobsApiGuard)
export class SemanticRankExportReadController {
  constructor(private readonly ranks: KeywordRankComparisonService) {}
  @Get("rank-dimensions")
  async dimensions(@Param("projectId") projectId: string, @Headers() headers: HeadersMap, @Req() request: FastifyRequest) {
    return { data: await this.ranks.catalog(context(projectId, headers)), meta: { requestId: request.id } };
  }
  @Post("rank-comparison")
  @HttpCode(200)
  async compare(@Param("projectId") projectId: string, @Headers() headers: HeadersMap, @Body() value: unknown, @Req() request: FastifyRequest) {
    const scope = context(projectId, headers);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Invalid export comparison");
    const { workspaceId, projectId: bodyProjectId, actorId, ...body } = value as Record<string, unknown>;
    if (workspaceId !== scope.workspaceId || bodyProjectId !== scope.projectId || actorId !== scope.actorId) throw new BadRequestException("Export comparison context mismatch");
    let input;
    try { input = parseSemanticRankComparisonInput(body); } catch { throw new BadRequestException("Invalid export comparison selection"); }
    return { data: await this.ranks.compare(scope, input), meta: { requestId: request.id } };
  }
}
function context(projectId: string, headers: HeadersMap) {
  const scope = internalCommandContext(headers);
  if (internalUuid(projectId, "projectId") !== scope.projectId) throw new BadRequestException("Route project context mismatch");
  return scope;
}
