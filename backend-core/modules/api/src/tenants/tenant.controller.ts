import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  ApiResponse,
  ProjectDeletionResult,
  ProjectSummary,
  WorkspaceSummary
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  apiResponse,
  collectionResponse
} from "../common/api-response.js";
import { requiredVersion } from "../common/version-precondition.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import { RecentAuthenticationService } from "../identity/recent-authentication.service.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  createProjectInput,
  createWorkspaceInput,
  deleteProjectInput,
  updateProjectInput,
  updateWorkspaceAvatarInput,
  updateWorkspaceInput
} from "./tenant-input.js";
import { TenantService } from "./tenant.service.js";

@Controller("api/v1")
export class TenantController {
  public constructor(
    private readonly tenants: TenantService,
    private readonly recentAuthentication: RecentAuthenticationService
  ) {}

  @Get("workspaces")
  @UseGuards(SessionAuthGuard)
  public async workspaces(
    @Req() request: FastifyRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<WorkspaceSummary>> {
    return collectionResponse(
      request,
      await this.tenants.listWorkspaces(principal.userId)
    );
  }

  @Post("workspaces")
  @UseGuards(CsrfSessionGuard)
  public async createWorkspace(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceSummary>> {
    const workspace = await this.tenants.createWorkspace(
      principal.userId,
      createWorkspaceInput(body),
      requestContext(request)
    );
    setEntityVersion(reply, workspace.version);
    return apiResponse(request, workspace, workspace.version);
  }

  @Get("workspaces/:workspaceId")
  @RequirePermission("workspace.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async workspace(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceSummary>> {
    const workspaceId = requiredWorkspaceId(request);
    const workspace = await this.tenants.getWorkspace(
      principal.userId,
      workspaceId
    );
    setEntityVersion(reply, workspace.version);
    return apiResponse(request, workspace, workspace.version);
  }

  @Patch("workspaces/:workspaceId")
  @RequirePermission("workspace.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async updateWorkspace(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceSummary>> {
    const workspace = await this.tenants.updateWorkspace(
      principal.userId,
      requiredWorkspaceId(request),
      requiredVersion(headerValue(request, "if-match")),
      updateWorkspaceInput(body),
      requestContext(request)
    );
    setEntityVersion(reply, workspace.version);
    return apiResponse(request, workspace, workspace.version);
  }

  @Get("workspaces/:workspaceId/avatar")
  @RequirePermission("workspace.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async workspaceAvatar(
    @Req() request: TenantRequest,
    @Res() reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const avatar = await this.tenants.getWorkspaceAvatar(
      principal.userId,
      requiredWorkspaceId(request)
    );
    reply
      .header("Cache-Control", "private, max-age=300")
      .header("Content-Type", avatar.contentType)
      .header("Last-Modified", avatar.updatedAt.toUTCString())
      .header("X-Content-Type-Options", "nosniff")
      .send(avatar.data);
  }

  @Put("workspaces/:workspaceId/avatar")
  @RequirePermission("workspace.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async updateWorkspaceAvatar(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceSummary>> {
    const workspace = await this.tenants.updateWorkspaceAvatar(
      principal.userId,
      requiredWorkspaceId(request),
      requiredVersion(headerValue(request, "if-match")),
      updateWorkspaceAvatarInput(body),
      requestContext(request)
    );
    setEntityVersion(reply, workspace.version);
    return apiResponse(request, workspace, workspace.version);
  }

  @Delete("workspaces/:workspaceId/avatar")
  @RequirePermission("workspace.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async deleteWorkspaceAvatar(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<WorkspaceSummary>> {
    const workspace = await this.tenants.deleteWorkspaceAvatar(
      principal.userId,
      requiredWorkspaceId(request),
      requiredVersion(headerValue(request, "if-match")),
      requestContext(request)
    );
    setEntityVersion(reply, workspace.version);
    return apiResponse(request, workspace, workspace.version);
  }

  @Get("workspaces/:workspaceId/projects")
  @RequirePermission("project.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async projects(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiCollectionResponse<ProjectSummary>> {
    return collectionResponse(
      request,
      await this.tenants.listProjects(
        principal.userId,
        requiredWorkspaceId(request)
      )
    );
  }

  @Post("workspaces/:workspaceId/projects")
  @RequirePermission("project.create")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async createProject(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectSummary>> {
    const project = await this.tenants.createProject(
      principal.userId,
      requiredWorkspaceId(request),
      createProjectInput(body),
      requestContext(request)
    );
    setEntityVersion(reply, project.version);
    return apiResponse(request, project, project.version);
  }

  @Get("projects/:projectId")
  @RequirePermission("project.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async project(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<ProjectSummary>> {
    const project = await this.tenants.getProject(requiredProjectId(request));
    setEntityVersion(reply, project.version);
    return apiResponse(
      request,
      authorizedProjectSummary(request, project),
      project.version
    );
  }

  @Patch("projects/:projectId")
  @RequirePermission("project.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async updateProject(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectSummary>> {
    const project = await this.tenants.updateProject(
      principal.userId,
      requiredProjectId(request),
      requiredVersion(headerValue(request, "if-match")),
      updateProjectInput(body),
      requestContext(request)
    );
    setEntityVersion(reply, project.version);
    return apiResponse(
      request,
      authorizedProjectSummary(request, project),
      project.version
    );
  }

  @Post("projects/:projectId/archive")
  @RequirePermission("project.archive")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  @HttpCode(200)
  public async archiveProject(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectSummary>> {
    const project = await this.tenants.archiveProject(
      principal.userId,
      requiredProjectId(request),
      requiredVersion(headerValue(request, "if-match")),
      requestContext(request)
    );
    setEntityVersion(reply, project.version);
    return apiResponse(
      request,
      authorizedProjectSummary(request, project),
      project.version
    );
  }

  @Post("projects/:projectId/restore")
  @RequirePermission("project.restore")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  @HttpCode(200)
  public async restoreProject(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectSummary>> {
    const project = await this.tenants.restoreProject(
      principal.userId,
      requiredProjectId(request),
      requiredVersion(headerValue(request, "if-match")),
      requestContext(request)
    );
    setEntityVersion(reply, project.version);
    return apiResponse(
      request,
      authorizedProjectSummary(request, project),
      project.version
    );
  }

  @Delete("projects/:projectId")
  @RequirePermission("project.delete")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async deleteProject(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectDeletionResult>> {
    this.recentAuthentication.assert(principal);
    const result = await this.tenants.deleteProject(
      principal.userId,
      requiredProjectId(request),
      requiredVersion(headerValue(request, "if-match")),
      deleteProjectInput(body),
      requestContext(request)
    );
    return apiResponse(request, result);
  }
}
function requiredWorkspaceId(request: TenantRequest): string {
  const workspaceId = request.tenantAuthorization?.workspaceId;
  if (!workspaceId) throw new Error("Workspace authorization is missing");
  return workspaceId;
}

function requiredProjectId(request: TenantRequest): string {
  const projectId = request.tenantAuthorization?.projectId;
  if (!projectId) throw new Error("Project authorization is missing");
  return projectId;
}

function authorizedProjectSummary(
  request: TenantRequest,
  project: ProjectSummary
): ProjectSummary {
  const projectAccessLevel = request.tenantAuthorization?.projectAccessLevel;
  return {
    ...project,
    ...(projectAccessLevel ? { projectAccessLevel } : {})
  };
}

function setEntityVersion(reply: FastifyReply, version: number): void {
  reply.header("ETag", `"v${version}"`);
}
