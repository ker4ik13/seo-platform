import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  parseWorkerNodeConfiguration,
  type ApiResponse,
  type CreatedWorkerNode,
  type WorkerNodeView
} from "@seo-platform/contracts";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { apiResponse } from "../common/api-response.js";
import { RequirePlatformRole } from "./platform-role.js";
import { PlatformRoleGuard, type PlatformAdminRequest } from "./platform-role.guard.js";
import { PlatformAdminWorkerNodeService } from "./platform-admin-worker-nodes.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Controller("admin-api/v1/worker-nodes")
@RequirePlatformRole("OPERATIONS")
@UseGuards(SessionAuthGuard, PlatformRoleGuard)
export class PlatformAdminWorkerNodeController {
  public constructor(private readonly nodes: PlatformAdminWorkerNodeService) {}

  @Get()
  public async list(
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<readonly WorkerNodeView[]>> {
    return apiResponse(request, await this.nodes.list(principal.userId, request.id));
  }

  @Post()
  public async create(
    @Body() body: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CreatedWorkerNode>> {
    return apiResponse(request, await this.nodes.create(
      configuration(body), principal.userId, request.id
    ));
  }

  @Patch(":id/configuration")
  public async configure(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkerNodeView>> {
    return apiResponse(request, await this.nodes.configure(
      nodeId(id), configuration(body), principal.userId, request.id
    ));
  }

  @Post(":id/rotate")
  public async rotate(
    @Param("id") id: string,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CreatedWorkerNode>> {
    return apiResponse(request, await this.nodes.rotate(
      nodeId(id), principal.userId, request.id
    ));
  }

  @Patch(":id/enabled")
  public async enabled(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkerNodeView>> {
    return apiResponse(request, await this.nodes.enabled(
      nodeId(id), flag(body, "enabled"), principal.userId, request.id
    ));
  }

  @Patch(":id/draining")
  public async draining(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkerNodeView>> {
    return apiResponse(request, await this.nodes.draining(
      nodeId(id), flag(body, "draining"), principal.userId, request.id
    ));
  }
}

function nodeId(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new BadRequestException("Invalid worker node ID");
  return value.toLowerCase();
}

function configuration(value: unknown) {
  try {
    return parseWorkerNodeConfiguration(value);
  } catch {
    throw new BadRequestException("Invalid worker node configuration");
  }
}

function flag(value: unknown, key: "enabled" | "draining"): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("Invalid worker node state");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input[key] !== "boolean") {
    throw new BadRequestException("Invalid worker node state");
  }
  return input[key];
}
