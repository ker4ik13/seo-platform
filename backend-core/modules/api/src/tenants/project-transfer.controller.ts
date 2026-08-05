import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  ApiResponse,
  ProjectTransferRequestSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse, collectionResponse } from "../common/api-response.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import {
  acceptProjectTransferInput,
  createProjectTransferInput
} from "./project-transfer.input.js";
import { ProjectTransferService } from "./project-transfer.service.js";

@Controller("api/v1")
export class ProjectTransferController {
  public constructor(private readonly transfers: ProjectTransferService) {}

  @Get("projects/:projectId/transfer")
  @RequirePermission("project.transfer")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async current(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectTransferRequestSummary | null>> {
    return apiResponse(
      request,
      await this.transfers.current(
        principal.userId,
        requiredProjectId(request)
      )
    );
  }

  @Post("projects/:projectId/transfer")
  @RequirePermission("project.transfer")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async requestTransfer(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectTransferRequestSummary>> {
    return apiResponse(
      request,
      await this.transfers.request(
        principal.userId,
        requiredProjectId(request),
        createProjectTransferInput(body).targetMemberId,
        requestContext(request)
      )
    );
  }

  @Delete("projects/:projectId/transfer")
  @RequirePermission("project.transfer")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  @HttpCode(200)
  public async cancel(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectTransferRequestSummary>> {
    return apiResponse(
      request,
      await this.transfers.cancel(
        principal.userId,
        requiredProjectId(request),
        requestContext(request)
      )
    );
  }

  @Get("me/project-transfers")
  @UseGuards(SessionAuthGuard)
  public async incoming(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<ProjectTransferRequestSummary>> {
    return collectionResponse(
      request,
      await this.transfers.incoming(principal.userId)
    );
  }

  @Post("project-transfers/:transferId/accept")
  @UseGuards(CsrfSessionGuard)
  @HttpCode(200)
  public async accept(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectTransferRequestSummary>> {
    return apiResponse(
      request,
      await this.transfers.accept(
        principal.userId,
        routeParam(request, "transferId"),
        acceptProjectTransferInput(body).destinationWorkspaceId,
        requestContext(request)
      )
    );
  }

  @Post("project-transfers/:transferId/decline")
  @UseGuards(CsrfSessionGuard)
  @HttpCode(200)
  public async decline(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectTransferRequestSummary>> {
    return apiResponse(
      request,
      await this.transfers.decline(
        principal.userId,
        routeParam(request, "transferId"),
        requestContext(request)
      )
    );
  }
}

function requiredProjectId(request: TenantRequest): string {
  const projectId = request.tenantAuthorization?.projectId;
  if (!projectId) throw new Error("Project authorization is missing");
  return projectId;
}

function routeParam(request: FastifyRequest, name: string): string {
  const params = request.params as Readonly<Record<string, unknown>>;
  const value = params[name];
  if (typeof value !== "string") {
    throw new Error(`Route parameter ${name} is missing`);
  }
  return value;
}
