import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  KeywordResearchRunSummary,
  KeywordResearchRowPage
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { IntegrationCredentialApiGuard } from "../integrations/integration-credential-api.guard.js";
import {
  internalCancelKeywordResearchRunInput,
  internalConfirmKeywordResearchRunInput,
  internalCreateKeywordResearchRunInput,
  internalRetryKeywordResearchImportInput,
  keywordResearchRowsQuery
} from "./keyword-research-input.js";
import { KeywordResearchService } from "./keyword-research.service.js";

type HeadersRecord = Readonly<Record<string, string | string[] | undefined>>;

@Controller(
  "internal/v1/workspaces/:workspaceId/projects/:projectId/keyword-research-runs"
)
@UseGuards(IntegrationCredentialApiGuard)
export class KeywordResearchController {
  public constructor(private readonly research: KeywordResearchService) {}

  @Get()
  public async list(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{ readonly runs: readonly KeywordResearchRunSummary[] }>> {
    const context = routeContext(workspaceId, projectId, headers);
    return response(request, {
      runs: await this.research.list(context.workspaceId, context.projectId)
    });
  }

  @Post()
  public async create(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<KeywordResearchRunSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    const input = internalCreateKeywordResearchRunInput(body);
    assertInternalContext(input, context);
    return response(request, await this.research.create(input));
  }

  @Get(":runId")
  public async get(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<KeywordResearchRunSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    return response(
      request,
      await this.research.get(
        context.workspaceId,
        context.projectId,
        internalUuid(runId, "runId")
      )
    );
  }

  @Get(":runId/rows")
  public async rows(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<KeywordResearchRowPage>> {
    const context = routeContext(workspaceId, projectId, headers);
    return response(
      request,
      await this.research.rows(
        context.workspaceId,
        context.projectId,
        internalUuid(runId, "runId"),
        keywordResearchRowsQuery(cursor, limit)
      )
    );
  }

  @Post(":runId/confirm")
  public async confirm(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<KeywordResearchRunSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    const input = internalConfirmKeywordResearchRunInput(body);
    assertInternalContext(input, context);
    return response(
      request,
      await this.research.confirm(internalUuid(runId, "runId"), input)
    );
  }

  @Post(":runId/cancel")
  public async cancel(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<KeywordResearchRunSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    const input = internalCancelKeywordResearchRunInput(body);
    assertInternalContext(input, context);
    return response(
      request,
      await this.research.cancel(internalUuid(runId, "runId"), input)
    );
  }

  @Post(":runId/retry-import")
  public async retryImport(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Headers() headers: HeadersRecord,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<KeywordResearchRunSummary>> {
    const context = routeContext(workspaceId, projectId, headers);
    const input = internalRetryKeywordResearchImportInput(body);
    assertInternalContext(input, context);
    return response(
      request,
      await this.research.retryImport(internalUuid(runId, "runId"), input)
    );
  }
}

function routeContext(
  workspaceId: string,
  projectId: string,
  headers: HeadersRecord
) {
  const context = internalCommandContext(headers);
  if (
    context.workspaceId !== internalUuid(workspaceId, "workspaceId") ||
    context.projectId !== internalUuid(projectId, "projectId")
  ) {
    throw new BadRequestException(
      "Route tenant context does not match trusted context"
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
