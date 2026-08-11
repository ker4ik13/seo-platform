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
  InternalAdminOperationSearchResult,
  ApiResponse,
  ProjectOperationActivitySummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  internalUuid,
  internalWorkspaceCommandContext
} from "../internal/internal-command-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { OperationActivityService } from "./operation-activity.service.js";
import { platformAdminOperationQuery } from "./platform-admin-operation-input.js";

type HeadersRecord = Readonly<Record<string, string | string[] | undefined>>;

@Controller("internal/v1/workspaces/:workspaceId/operation-activity")
@UseGuards(PlatformApiGuard)
export class OperationActivityController {
  public constructor(private readonly activity: OperationActivityService) {}

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

@Controller("internal/v1/platform-admin/operations")
@UseGuards(PlatformApiGuard)
export class PlatformAdminOperationController {
  public constructor(private readonly activity: OperationActivityService) {}

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
}
