import {
  Controller,
  Get,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  ProjectPresenceMember
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { requiredProjectTenant } from "../authorization/project-tenant.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { apiResponse } from "../common/api-response.js";
import { SessionAuthGuard } from "../identity/session-auth.guard.js";
import { ProjectPresenceService } from "./project-presence.service.js";

@Controller("api/v1/projects/:projectId/presence-members")
export class ProjectPresenceController {
  public constructor(private readonly presence: ProjectPresenceService) {}

  @Get()
  @RequirePermission("presence.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async members(
    @Req() request: TenantRequest
  ): Promise<ApiResponse<readonly ProjectPresenceMember[]>> {
    const tenant = requiredProjectTenant(request);
    return apiResponse(
      request,
      await this.presence.listMembers(
        tenant.workspaceId,
        requiredProjectId(tenant.projectId)
      )
    );
  }

  @Get(":userId/avatar")
  @RequirePermission("presence.view")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async avatar(
    @Req() request: TenantRequest,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const tenant = requiredProjectTenant(request);
    const avatar = await this.presence.getMemberAvatar(
      tenant.workspaceId,
      requiredProjectId(tenant.projectId),
      routeParam(request, "userId")
    );
    reply
      .header("Cache-Control", "private, max-age=300")
      .header("Content-Type", avatar.contentType)
      .header("Last-Modified", avatar.updatedAt.toUTCString())
      .header("Cross-Origin-Resource-Policy", "same-origin")
      .header("X-Content-Type-Options", "nosniff")
      .send(avatar.data);
  }
}

function requiredProjectId(projectId: string | undefined): string {
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
