import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  SemanticKeywordListItem
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { InternalApiGuard } from "../internal/internal-api.guard.js";
import { keywordListQuery } from "./keyword-query.js";
import { KeywordService } from "./keyword.service.js";

@Controller("internal/v1/projects/:projectId/keywords")
@UseGuards(InternalApiGuard)
export class KeywordController {
  public constructor(private readonly keywords: KeywordService) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Query() query: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const context = internalCommandContext(headers);
    if (internalUuid(projectId, "projectId") !== context.projectId) {
      throw new BadRequestException(
        "Route project identifier does not match trusted context"
      );
    }
    return this.keywords.list(
      context.workspaceId,
      context.projectId,
      keywordListQuery(query),
      request.id
    );
  }
}
