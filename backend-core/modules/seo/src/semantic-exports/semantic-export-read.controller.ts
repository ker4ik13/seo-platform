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
  ApiResponse,
  SemanticCompetitorExportKeyword,
  SemanticCompetitorExportOptions,
  SemanticCustomColumn,
  SemanticKeywordGroup,
  SemanticKeywordListItem,
  SemanticPositionHistoryExportOptions,
  SemanticPositionHistoryExportRow
} from "@seo-platform/contracts";
import {
  semanticCompetitorExportSources,
  semanticPositionHistorySearchEngines
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { JobsApiGuard } from "../internal/jobs-api.guard.js";
import { KeywordGroupService } from "../keyword-groups/keyword-group.service.js";
import { keywordListQuery } from "../keywords/keyword-query.js";
import { KeywordService } from "../keywords/keyword.service.js";
import { SemanticCustomColumnService } from "../semantic-custom-columns/semantic-custom-column.service.js";
import { SemanticCompetitorExportService } from "./semantic-competitor-export.service.js";
import { SemanticPositionHistoryExportService } from "./semantic-position-history-export.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/projects/:projectId/semantic-exports")
@UseGuards(JobsApiGuard)
export class SemanticExportReadController {
  public constructor(
    private readonly keywords: KeywordService,
    private readonly groups: KeywordGroupService,
    private readonly columns: SemanticCustomColumnService,
    private readonly positionHistory: SemanticPositionHistoryExportService,
    private readonly competitors: SemanticCompetitorExportService
  ) {}

  @Get("keywords")
  public async listKeywords(
    @Param("projectId") projectId: string,
    @Query() query: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const context = routeContext(projectId, headers);
    return this.keywords.list(
      context.workspaceId,
      context.projectId,
      keywordListQuery(query),
      request.id
    );
  }

  @Get("competitors")
  public async listCompetitors(
    @Param("projectId") projectId: string,
    @Query() query: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiCollectionResponse<SemanticCompetitorExportKeyword>> {
    const context = routeContext(projectId, headers);
    return this.competitors.list(
      context,
      keywordListQuery(query),
      competitorOptions(query),
      request.id
    );
  }

  @Get("position-history")
  public async listPositionHistory(
    @Param("projectId") projectId: string,
    @Query() query: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiCollectionResponse<SemanticPositionHistoryExportRow>> {
    const context = routeContext(projectId, headers);
    return this.positionHistory.list(
      context,
      keywordListQuery(query),
      positionHistoryOptions(query),
      request.id
    );
  }

  @Get("keyword-groups")
  public async listKeywordGroups(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticKeywordGroup[]>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.groups.list(context.workspaceId, context.projectId)
    );
  }

  @Get("custom-columns")
  public async listCustomColumns(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticCustomColumn[]>> {
    const context = routeContext(projectId, headers);
    return response(
      request,
      await this.columns.list(context.workspaceId, context.projectId)
    );
  }
}

function positionHistoryOptions(
  value: unknown
): SemanticPositionHistoryExportOptions {
  const query = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
  const observedFrom = canonicalInstant(query.observedFrom, "observedFrom");
  const observedBefore = canonicalInstant(query.observedBefore, "observedBefore");
  const duration = Date.parse(observedBefore) - Date.parse(observedFrom);
  if (duration <= 0 || duration > 1_100 * 24 * 60 * 60 * 1_000) {
    throw new BadRequestException("Invalid position-history date interval");
  }
  if (typeof query.searchEngines !== "string") {
    throw new BadRequestException("Invalid position-history search engines");
  }
  const searchEngines = query.searchEngines.split(",").map((item) => item.trim());
  if (
    searchEngines.length < 1 ||
    searchEngines.length > semanticPositionHistorySearchEngines.length ||
    new Set(searchEngines).size !== searchEngines.length ||
    searchEngines.some((engine) => !semanticPositionHistorySearchEngines.includes(
      engine as (typeof semanticPositionHistorySearchEngines)[number]
    ))
  ) {
    throw new BadRequestException("Invalid position-history search engines");
  }
  return {
    observedFrom,
    observedBefore,
    searchEngines: searchEngines as SemanticPositionHistoryExportOptions["searchEngines"]
  };
}

function competitorOptions(value: unknown): SemanticCompetitorExportOptions {
  const query = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
  if (typeof query.sources !== "string") {
    throw new BadRequestException("Invalid competitor export sources");
  }
  const sources = query.sources.split(",").map((item) => item.trim());
  if (
    sources.length < 1 ||
    sources.length > semanticCompetitorExportSources.length ||
    new Set(sources).size !== sources.length ||
    sources.some((source) => !semanticCompetitorExportSources.includes(
      source as (typeof semanticCompetitorExportSources)[number]
    ))
  ) {
    throw new BadRequestException("Invalid competitor export sources");
  }
  return {
    sources: sources as SemanticCompetitorExportOptions["sources"]
  };
}

function canonicalInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length !== 24) {
    throw new BadRequestException(`Invalid position-history ${field}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new BadRequestException(`Invalid position-history ${field}`);
  }
  return value;
}

function routeContext(projectId: string, headers: InternalHeaders) {
  const context = internalCommandContext(headers);
  if (internalUuid(projectId, "projectId") !== context.projectId) {
    throw new BadRequestException(
      "Route project identifier does not match trusted context"
    );
  }
  return context;
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
