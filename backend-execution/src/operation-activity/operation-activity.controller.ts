import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  InternalDismissProjectOperationInput,
  InternalWorkspaceExecutionUsage,
  InternalAdminOperationSearchResult,
  InternalAdminOperationSummary,
  ApiResponse,
  ProjectOperationActivitySummary,
  ProjectOperationDismissal
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  internalCommandContext,
  internalUuid,
  internalWorkspaceCommandContext
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { OperationActivityService } from "./operation-activity.service.js";
import { platformAdminOperationQuery } from "./platform-admin-operation-input.js";
import { OperationCancellationService } from "./operation-cancellation.service.js";

type HeadersRecord = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/workspaces/:workspaceId/operation-activity")
@UseGuards(PlatformApiGuard)
export class OperationActivityController {
  public constructor(private readonly activity: OperationActivityService) {}

  @Get("usage")
  public async usage(
    @Param("workspaceId") workspaceId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalWorkspaceExecutionUsage>> {
    const context = internalWorkspaceCommandContext(headers);
    if (internalUuid(workspaceId, "workspaceId") !== context.workspaceId) {
      throw new BadRequestException("Workspace context mismatch");
    }
    return { data: await this.activity.workspaceUsage(context.workspaceId), meta: { requestId: request.id } };
  }

  @Get()
  public async list(
    @Param("workspaceId") workspaceId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<{
    readonly projects: readonly ProjectOperationActivitySummary[];
  }>> {
    const context = internalWorkspaceCommandContext(headers);
    if (internalUuid(workspaceId, "workspaceId") !== context.workspaceId) {
      throw new BadRequestException(
        "Route Workspace identifier does not match trusted context"
      );
    }
    return {
      data: { projects: await this.activity.list(context.workspaceId) },
      meta: { requestId: request.id }
    };
  }
}

@Controller("internal/v1/workspaces/:workspaceId/projects/:projectId/operations")
@UseGuards(PlatformApiGuard)
export class ProjectOperationController {
  public constructor(private readonly activity: OperationActivityService) {}

  @Delete(":operationId")
  public async dismiss(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("operationId") operationId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectOperationDismissal>> {
    const context = internalCommandContext(headers);
    const input: InternalDismissProjectOperationInput = {
      workspaceId: internalUuid(workspaceId, "workspaceId"),
      projectId: internalUuid(projectId, "projectId"),
      actorId: context.actorId,
      operationId: internalUuid(operationId, "operationId")
    };
    if (
      input.workspaceId !== context.workspaceId ||
      input.projectId !== context.projectId
    ) {
      throw new BadRequestException("Operation scope does not match trusted context");
    }
    return {
      data: await this.activity.dismiss(input),
      meta: { requestId: request.id }
    };
  }
}

@Controller("internal/v1/platform-admin/operations")
@UseGuards(PlatformApiGuard)
export class PlatformAdminOperationController {
  public constructor(private readonly activity: OperationActivityService, private readonly cancellation: OperationCancellationService) {}

  @Post(":operationId/cancel")
  public async cancel(@Param("operationId") id: string, @Headers() headers: HeadersRecord, @Body() body: unknown, @Req() req: FastifyRequest): Promise<ApiResponse<InternalAdminOperationSummary>> {
    if (!body || typeof body !== "object" || Object.keys(body).length !== 0) throw new BadRequestException("Empty command expected");
    const actor = internalUuid(String(headers["x-actor-id"]), "actorId");
    const operationId = internalUuid(id, "operationId");
    await this.cancellation.cancel(operationId, actor);
    return { data: await this.activity.adminDetail(operationId), meta: { requestId: req.id } };
  }

  @Get("overview")
  public async overview(@Headers() headers: HeadersRecord, @Req() request: FastifyRequest) {
    internalUuid(String(headers["x-actor-id"]), "actorId");
    return { data: await this.activity.overview(), meta: { requestId: request.id } };
  }

  @Get()
  public async list(
    @Query("status") status: unknown,
    @Query("type") type: unknown,
    @Query("cursor") cursor: unknown,
    @Query("limit") limit: unknown,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalAdminOperationSearchResult>> {
    const actor = headers["x-actor-id"];
    if (typeof actor !== "string") {
      throw new BadRequestException("Missing trusted internal actor");
    }
    internalUuid(actor, "actorId");
    return {
      data: await this.activity.adminList(
        platformAdminOperationQuery({ status, type, cursor, limit })
      ),
      meta: { requestId: request.id }
    };
  }

  @Get(":operationId")
  public async detail(
    @Param("operationId") operationId: string,
    @Headers() headers: HeadersRecord,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalAdminOperationSummary>> {
    const actor = headers["x-actor-id"];
    if (typeof actor !== "string") {
      throw new BadRequestException("Missing trusted internal actor");
    }
    internalUuid(actor, "actorId");
    return {
      data: await this.activity.adminDetail(
        internalUuid(operationId, "operationId")
      ),
      meta: { requestId: request.id }
    };
  }
}
