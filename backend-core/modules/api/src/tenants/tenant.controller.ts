import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Optional,
  Patch,
  Post,
  Put,
  ServiceUnavailableException,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  ApiResponse,
  ProjectDeletionResult,
  ProjectCollectionCapabilities,
  ProjectOperationActivityCollection,
  ProjectOrderResult,
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
  reorderProjectsInput,
  updateProjectInput,
  updateProjectLogoInput,
  updateWorkspaceAvatarInput,
  updateWorkspaceInput
} from "./tenant-input.js";
import { TenantService } from "./tenant.service.js";
import { ProjectLogoService } from "./project-logo.service.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { ProjectOnboardingService } from "./project-onboarding.service.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";

@Controller("api/v1")
export class TenantController {
  private readonly logger = new Logger(TenantController.name);

  public constructor(
    private readonly tenants: TenantService,
    private readonly projectLogos: ProjectLogoService,
    @Optional() private readonly jobs?: JobsClient,
    @Optional() private readonly onboarding?: ProjectOnboardingService
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
    const workspaceId = requiredWorkspaceId(request);
    const projects = apiTokenVisibleProjects(
      await this.tenants.listProjects(principal.userId, workspaceId),
      request
    );
    let activity = new Map<string, number>();
    if (this.jobs && request.tenantAuthorization) {
      try {
        activity = new Map(
          await this.jobs.listProjectOperationActivity({
            tenant: request.tenantAuthorization,
            actorId: principal.userId,
            requestId: requestContext(request).requestId
          })
        );
      } catch {
        this.logger.warn(
          `Project operation activity is unavailable for request ${requestContext(request).requestId}`
        );
      }
    }
    return collectionResponse(
      request,
      projects.map((project) => {
        const activeOperationCount = activity.get(project.id);
        return activeOperationCount
          ? { ...project, activeOperationCount }
          : project;
      })
    );
  }

  @Get("workspaces/:workspaceId/operation-activity")
  @RequirePermission("project.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async projectOperationActivity(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectOperationActivityCollection>> {
    const workspaceId = requiredWorkspaceId(request);
    if (!this.jobs || !request.tenantAuthorization) {
      throw new ServiceUnavailableException(
        "Operation activity is temporarily unavailable"
      );
    }
    const visibleProjects = apiTokenVisibleProjects(
      await this.tenants.listProjects(principal.userId, workspaceId),
      request
    );
    const visibleProjectIds = new Set(visibleProjects.map(({ id }) => id));
    let activity: ReadonlyMap<string, number>;
    try {
      activity = await this.jobs.listProjectOperationActivity({
        tenant: request.tenantAuthorization,
        actorId: principal.userId,
        requestId: requestContext(request).requestId
      });
    } catch {
      this.logger.warn(
        `Authoritative operation activity is unavailable for request ${requestContext(request).requestId}`
      );
      throw new ServiceUnavailableException(
        "Operation activity is temporarily unavailable"
      );
    }
    return apiResponse(request, {
      projects: [...activity]
        .filter(([projectId]) => visibleProjectIds.has(projectId))
        .map(([projectId, activeOperationCount]) => ({
          projectId,
          activeOperationCount
        }))
    });
  }

  @Get("workspaces/:workspaceId/project-capabilities")
  @RequirePermission("project.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async projectCapabilities(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectCollectionCapabilities>> {
    const tenant = request.tenantAuthorization;
    if (!tenant) throw new Error("Workspace authorization is missing");
    return apiResponse(
      request,
      await this.tenants.projectCollectionCapabilities(
        principal.userId,
        tenant.workspaceId,
        tenant.roleCode,
        tenant.workspaceStatus
      )
    );
  }

  @Put("workspaces/:workspaceId/projects/order")
  @RequirePermission("workspace.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async reorderProjects(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectOrderResult>> {
    return apiResponse(
      request,
      await this.tenants.reorderProjects(
        principal.userId,
        requiredWorkspaceId(request),
        reorderProjectsInput(body),
        requestContext(request)
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
    const input = createProjectInput(body);
    const key = input.onboarding ? requiredIdempotencyKey(headerValue(request, "idempotency-key")) : undefined;
    if (input.onboarding && !this.onboarding) throw new ServiceUnavailableException("Project onboarding is unavailable");
    const project = await this.tenants.createProject(
      principal.userId,
      requiredWorkspaceId(request),
      input,
      requestContext(request),
      key
    );
    if (input.onboarding) await this.onboarding!.initialize(principal.userId, project, requestContext(request));
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

  @Get("projects/:projectId/logo")
  @RequirePermission("project.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async projectLogo(
    @Req() request: TenantRequest,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const logo = await this.projectLogos.get(requiredProjectId(request));
    reply
      .header("Cache-Control", "private, max-age=3600")
      .header("Content-Type", logo.contentType)
      .header("Content-Disposition", `inline; filename="project-logo${logoExtension(logo.contentType)}"`)
      .header("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
      .header("Cross-Origin-Resource-Policy", "same-origin")
      .header("Last-Modified", logo.updatedAt.toUTCString())
      .header("X-Content-Type-Options", "nosniff")
      .send(logo.data);
  }

  @Put("projects/:projectId/logo")
  @RequirePermission("project.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async updateProjectLogo(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectSummary>> {
    const project = await this.projectLogos.update(
      principal.userId,
      requiredProjectId(request),
      requiredVersion(headerValue(request, "if-match")),
      updateProjectLogoInput(body),
      requestContext(request)
    );
    setEntityVersion(reply, project.version);
    return apiResponse(
      request,
      authorizedProjectSummary(request, project),
      project.version
    );
  }

  @Delete("projects/:projectId/logo")
  @RequirePermission("project.update")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async deleteProjectLogo(
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectSummary>> {
    const project = await this.projectLogos.delete(
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

function apiTokenVisibleProjects(
  projects: readonly ProjectSummary[],
  request: TenantRequest
): readonly ProjectSummary[] {
  const token = request.apiTokenAuthorization;
  if (!token || token.allProjects) return projects;
  const allowed = new Set(token.projectIds);
  return projects.filter(({ id }) => allowed.has(id));
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

function logoExtension(contentType: string): string {
  return {
    "image/svg+xml": ".svg",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/x-icon": ".ico",
    "image/gif": ".gif",
    "image/avif": ".avif"
  }[contentType] ?? "";
}
