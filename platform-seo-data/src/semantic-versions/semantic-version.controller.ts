import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalUndoSemanticVersionInput,
  SemanticVersionDetail,
  SemanticVersionListItem,
  SemanticVersionUndoPreview,
  SemanticVersionUndoResult
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  assertInternalContext,
  internalCommandContext,
  internalUuid
} from "../internal/internal-command-context.js";
import { semanticCapacityEntitlement } from "../internal/semantic-capacity.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import { SemanticVersionService } from "./semantic-version.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1/projects/:projectId/semantic-versions")
@UseGuards(PlatformApiGuard)
export class SemanticVersionController {
  public constructor(private readonly versions: SemanticVersionService) {}

  @Get()
  public async list(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<readonly SemanticVersionListItem[]>> {
    const context = routeContext(projectId, headers);
    return {
      data: await this.versions.list(context.workspaceId, context.projectId),
      meta: { requestId: request.id }
    };
  }

  @Get(":versionId")
  public async detail(
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticVersionDetail>> {
    const context = routeContext(projectId, headers);
    return {
      data: await this.versions.detail(
        context.workspaceId,
        context.projectId,
        internalUuid(versionId, "versionId")
      ),
      meta: { requestId: request.id }
    };
  }

  @Get(":versionId/undo-preview")
  public async previewUndo(
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticVersionUndoPreview>> {
    const context = routeContext(projectId, headers);
    return {
      data: await this.versions.previewUndo(
        context.workspaceId,
        context.projectId,
        internalUuid(versionId, "versionId")
      ),
      meta: { requestId: request.id }
    };
  }

  @Post(":versionId/undo")
  public async undo(
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<SemanticVersionUndoResult>> {
    const input = internalUndoInput(body);
    const context = routeContext(projectId, headers);
    assertInternalContext(context, input);
    return {
      data: await this.versions.undo(
        input.workspaceId,
        input.projectId,
        input.actorId,
        internalUuid(versionId, "versionId"),
        input.idempotencyKey,
        input.entitlement
      ),
      meta: { requestId: request.id }
    };
  }
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

function internalUndoInput(value: unknown): InternalUndoSemanticVersionInput {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new BadRequestException("Undo body must be an object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(input).length !== 5 ||
    typeof input.workspaceId !== "string" ||
    typeof input.projectId !== "string" ||
    typeof input.actorId !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9._:-]{8,180}$/u.test(input.idempotencyKey)
  ) {
    throw new BadRequestException("Invalid semantic version undo input");
  }
  return {
    workspaceId: internalUuid(input.workspaceId, "workspaceId"),
    projectId: internalUuid(input.projectId, "projectId"),
    actorId: internalUuid(input.actorId, "actorId"),
    idempotencyKey: input.idempotencyKey,
    entitlement: semanticCapacityEntitlement(input.entitlement)
  };
}
