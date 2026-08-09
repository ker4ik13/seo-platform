import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  ProjectNoteCollection,
  ProjectNoteSummary,
  PublicProjectNote
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredMutableProjectTenant,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { assertUuid } from "../common/identifier.js";
import { requiredVersion } from "../common/version-precondition.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import {
  createProjectNoteInput,
  projectNoteToken,
  updateProjectNoteInput
} from "./project-note-input.js";

@Controller("api/v1/projects/:projectId/notes")
export class ProjectNoteController {
  public constructor(
    private readonly seoData: SeoDataClient,
    private readonly audit: AuditService
  ) {}

  @Get()
  @RequirePermission("knowledge.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async list(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectNoteCollection>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.seoData.listProjectNotes(
        internalProjectContext(request, principal, tenant)
      )
    );
  }

  @Get(":noteId")
  @RequirePermission("knowledge.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async get(
    @Param("noteId") noteId: string,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectNoteSummary>> {
    const tenant = requiredProjectTenant(request);
    const result = await this.seoData.getProjectNote(
      internalProjectContext(request, principal, tenant),
      assertUuid(noteId, "noteId")
    );
    reply.header("ETag", `"v${result.version}"`);
    return apiResponse(request, result, result.version);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("knowledge.edit")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectNoteSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const result = await this.seoData.createProjectNote(
      internalProjectContext(request, principal, tenant),
      createProjectNoteInput(body)
    );
    await this.recordAudit(request, principal, "project_note.created", result.id);
    reply.header("ETag", `"v${result.version}"`);
    return apiResponse(request, result, result.version);
  }

  @Patch(":noteId")
  @RequirePermission("knowledge.edit")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async update(
    @Param("noteId") noteId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<ProjectNoteSummary>> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalId = assertUuid(noteId, "noteId");
    const result = await this.seoData.updateProjectNote(
      internalProjectContext(request, principal, tenant),
      canonicalId,
      updateProjectNoteInput(body),
      requiredVersion(headerValue(request, "if-match"))
    );
    await this.recordAudit(request, principal, "project_note.updated", canonicalId);
    reply.header("ETag", `"v${result.version}"`);
    return apiResponse(request, result, result.version);
  }

  @Delete(":noteId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission("knowledge.edit")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async archive(
    @Param("noteId") noteId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredMutableProjectTenant(request);
    const canonicalId = assertUuid(noteId, "noteId");
    await this.seoData.deleteProjectNote(
      internalProjectContext(request, principal, tenant),
      canonicalId,
      requiredVersion(headerValue(request, "if-match"))
    );
    await this.recordAudit(request, principal, "project_note.deleted", canonicalId);
  }

  private async recordAudit(
    request: TenantRequest,
    principal: AuthenticatedPrincipal,
    action: string,
    resourceId: string
  ): Promise<void> {
    const tenant = requiredProjectTenant(request);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action,
      resourceType: "project_note",
      resourceId,
      requestId: request.id
    });
  }
}

@Controller("api/v1/public/project-notes")
export class PublicProjectNoteController {
  public constructor(private readonly seoData: SeoDataClient) {}

  @Get(":token")
  public async get(
    @Param("token") token: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<PublicProjectNote>> {
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    return apiResponse(
      request,
      await this.seoData.getPublicProjectNote(
        projectNoteToken(token),
        request.id
      )
    );
  }
}
