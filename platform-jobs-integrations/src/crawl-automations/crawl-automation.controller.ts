import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  CrawlAutomationCollection,
  CrawlAutomationRunCollection,
  CrawlAutomationRunSummary,
  CrawlAutomationSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  internalCreateCrawlAutomationInput,
  internalCrawlAutomationStatusInput,
  internalRunCrawlAutomationInput,
  internalUpdateCrawlAutomationInput
} from "./crawl-automation-input.js";
import { CrawlAutomationExecutionService } from "./crawl-automation-execution.service.js";
import { CrawlAutomationService } from "./crawl-automation.service.js";

@Controller(
  "internal/v1/workspaces/:workspaceId/projects/:projectId/crawl-automations"
)
@UseGuards(PlatformApiGuard)
export class CrawlAutomationController {
  public constructor(
    private readonly automations: CrawlAutomationService,
    private readonly executions: CrawlAutomationExecutionService
  ) {}

  @Get()
  public async list(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Query("limit") limit: unknown,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CrawlAutomationCollection>> {
    const context = pathContext(workspaceId, projectId, headers);
    return response(
      request,
      await this.automations.list(
        context.workspaceId,
        context.projectId,
        positiveLimit(limit)
      )
    );
  }

  @Post()
  public async create(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CrawlAutomationSummary>> {
    const context = pathContext(workspaceId, projectId, headers);
    const input = internalCreateCrawlAutomationInput(body);
    assertInternalContext(input, context);
    return response(request, await this.automations.create(input));
  }

  @Get(":automationId/runs")
  public async listRuns(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("automationId") automationId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CrawlAutomationRunCollection>> {
    const context = pathContext(workspaceId, projectId, headers);
    return response(
      request,
      await this.executions.listRuns(
        context.workspaceId,
        context.projectId,
        internalUuid(automationId, "automationId")
      )
    );
  }

  @Post(":automationId/runs")
  public async run(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("automationId") automationId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CrawlAutomationRunSummary>> {
    const context = pathContext(workspaceId, projectId, headers);
    const input = internalRunCrawlAutomationInput(body);
    assertStatusRoute(input.automationId, automationId, context, input);
    return response(request, await this.executions.triggerManual(input));
  }

  @Patch(":automationId")
  public async update(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("automationId") automationId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CrawlAutomationSummary>> {
    const context = pathContext(workspaceId, projectId, headers);
    const input = internalUpdateCrawlAutomationInput(body);
    assertStatusRoute(input.automationId, automationId, context, input);
    return response(request, await this.automations.update(input));
  }

  @Post(":automationId/pause")
  public async pause(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("automationId") automationId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CrawlAutomationSummary>> {
    const context = pathContext(workspaceId, projectId, headers);
    const input = internalCrawlAutomationStatusInput(body);
    assertStatusRoute(input.automationId, automationId, context, input);
    return response(request, await this.automations.pause(input));
  }

  @Post(":automationId/resume")
  public async resume(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("automationId") automationId: string,
    @Headers() headers: Readonly<Record<string, string | string[] | undefined>>,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<CrawlAutomationSummary>> {
    const context = pathContext(workspaceId, projectId, headers);
    const input = internalCrawlAutomationStatusInput(body);
    assertStatusRoute(input.automationId, automationId, context, input);
    return response(request, await this.automations.resume(input));
  }
}

function pathContext(
  workspaceId: string,
  projectId: string,
  headers: Readonly<Record<string, string | string[] | undefined>>
) {
  const context = internalCommandContext(headers);
  assertInternalContext(
    {
      workspaceId: internalUuid(workspaceId, "workspaceId"),
      projectId: internalUuid(projectId, "projectId"),
      actorId: context.actorId
    },
    context
  );
  return context;
}

function assertStatusRoute(
  bodyAutomationId: string,
  routeAutomationId: string,
  context: ReturnType<typeof internalCommandContext>,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly actorId: string;
  }
): void {
  assertInternalContext(input, context);
  if (
    bodyAutomationId !== internalUuid(routeAutomationId, "automationId")
  ) {
    throw new BadRequestException(
      "Route automation identifier does not match body"
    );
  }
}

function positiveLimit(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{0,5}$/u.test(value) ||
    Number(value) > 100_000
  ) {
    throw new BadRequestException("Invalid automation plan limit");
  }
  return Number(value);
}

function response<Data>(
  request: FastifyRequest,
  data: Data
): ApiResponse<Data> {
  return { data, meta: { requestId: request.id } };
}
