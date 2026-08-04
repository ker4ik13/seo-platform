import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  ApiResponse,
  CreateWorkspaceInviteResult,
  PendingWorkspaceInviteSummary,
  WorkspaceInviteSummary,
  WorkspaceMemberSummary
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  apiResponse,
  collectionResponse
} from "../common/api-response.js";
import { requiredVersion } from "../common/version-precondition.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import {
  acceptWorkspaceInviteInput,
  createWorkspaceInviteInput,
  updateWorkspaceMemberInput,
  workspaceInviteListQuery,
  workspaceMemberListQuery
} from "./team-input.js";
import { TeamService } from "./team.service.js";

@Controller("api/v1")
export class TeamController {
  public constructor(private readonly team: TeamService) {}

  @Get("workspaces/:workspaceId/members")
  @RequirePermission("member.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async members(
    @Query() query: unknown,
    @Req() request: TenantRequest
  ): Promise<ApiCollectionResponse<WorkspaceMemberSummary>> {
    const result = await this.team.listMembers(
      requiredWorkspaceId(request),
      workspaceMemberListQuery(query)
    );
    return collectionResponse(
      request,
      result.data,
      result.page
    );
  }

  @Patch("workspaces/:workspaceId/members/:memberId")
  @RequirePermission("member.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async updateMember(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceMemberSummary>> {
    const member = await this.team.updateMember(
      principal.userId,
      requiredWorkspaceId(request),
      routeParam(request, "memberId"),
      requiredVersion(headerValue(request, "if-match")),
      updateWorkspaceMemberInput(body),
      requestContext(request)
    );
    reply.header("ETag", `"v${member.version}"`);
    return apiResponse(request, member, member.version);
  }

  @Delete("workspaces/:workspaceId/members/:memberId")
  @RequirePermission("member.remove")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  @HttpCode(200)
  public async removeMember(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceMemberSummary>> {
    const member = await this.team.removeMember(
      principal.userId,
      requiredWorkspaceId(request),
      routeParam(request, "memberId"),
      requiredVersion(headerValue(request, "if-match")),
      requestContext(request)
    );
    reply.header("ETag", `"v${member.version}"`);
    return apiResponse(request, member, member.version);
  }

  @Get("workspaces/:workspaceId/invites")
  @RequirePermission("member.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async invites(
    @Query() query: unknown,
    @Req() request: TenantRequest
  ): Promise<ApiCollectionResponse<WorkspaceInviteSummary>> {
    const result = await this.team.listInvites(
      requiredWorkspaceId(request),
      workspaceInviteListQuery(query)
    );
    return collectionResponse(
      request,
      result.data,
      result.page
    );
  }

  @Get("me/workspace-invites")
  @UseGuards(SessionAuthGuard)
  public async myPendingInvites(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<PendingWorkspaceInviteSummary>> {
    const result = await this.team.listPendingInvitesForUser(principal.userId);
    return collectionResponse(request, result.data, result.page);
  }

  @Post("workspaces/:workspaceId/invites")
  @RequirePermission("member.invite")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async createInvite(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<CreateWorkspaceInviteResult>> {
    return apiResponse(
      request,
      await this.team.createInvite(
        principal.userId,
        requiredWorkspaceId(request),
        createWorkspaceInviteInput(body),
        requestContext(request)
      )
    );
  }

  @Delete("workspaces/:workspaceId/invites/:inviteId")
  @RequirePermission("member.invite")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  @HttpCode(200)
  public async revokeInvite(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceInviteSummary>> {
    return apiResponse(
      request,
      await this.team.revokeInvite(
        principal.userId,
        requiredWorkspaceId(request),
        routeParam(request, "inviteId"),
        requestContext(request)
      )
    );
  }

  @Post("workspace-invites/accept")
  @UseGuards(CsrfSessionGuard)
  @HttpCode(200)
  public async acceptInvite(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceMemberSummary>> {
    const member = await this.team.acceptInvite(
      principal.userId,
      acceptWorkspaceInviteInput(body).token,
      requestContext(request)
    );
    reply.header("ETag", `"v${member.version}"`);
    return apiResponse(request, member, member.version);
  }

  @Post("workspace-invites/:inviteId/accept")
  @UseGuards(CsrfSessionGuard)
  @HttpCode(200)
  public async acceptInviteFromAccount(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceMemberSummary>> {
    const member = await this.team.acceptInviteById(
      principal.userId,
      routeParam(request, "inviteId"),
      requestContext(request)
    );
    reply.header("ETag", `"v${member.version}"`);
    return apiResponse(request, member, member.version);
  }

  @Post("workspace-invites/:inviteId/decline")
  @UseGuards(CsrfSessionGuard)
  @HttpCode(200)
  public async declineInviteFromAccount(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceInviteSummary>> {
    return apiResponse(
      request,
      await this.team.declineInvite(
        principal.userId,
        routeParam(request, "inviteId"),
        requestContext(request)
      )
    );
  }
}

function requiredWorkspaceId(request: TenantRequest): string {
  const workspaceId = request.tenantAuthorization?.workspaceId;
  if (!workspaceId) throw new Error("Workspace authorization is missing");
  return workspaceId;
}

function routeParam(request: FastifyRequest, name: string): string {
  const params = request.params as Readonly<Record<string, unknown>>;
  const value = params[name];
  if (typeof value !== "string") {
    throw new Error(`Route parameter ${name} is missing`);
  }
  return value;
}
