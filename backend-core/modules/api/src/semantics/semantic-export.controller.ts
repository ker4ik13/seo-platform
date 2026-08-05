import { Buffer } from "node:buffer";
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { RequirePermission } from "../authorization/require-permission.js";
import type { TenantRequest } from "../authorization/authorization.types.js";
import {
  internalProjectContext,
  requiredProjectTenant
} from "../authorization/project-tenant.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { recordCommittedAudit } from "../common/committed-audit.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import { createSemanticExportInput } from "./semantic-export-input.js";
import { SemanticExportService } from "./semantic-export.service.js";

@Controller("api/v1/projects/:projectId/exports")
export class SemanticExportController {
  private readonly logger = new Logger(SemanticExportController.name);

  public constructor(
    private readonly exports: SemanticExportService,
    private readonly audit: AuditService
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission("semantic.export")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async create(
    @Param("projectId") _projectId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @Res() reply: FastifyReply,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    const tenant = requiredProjectTenant(request);
    const context = requestContext(request);
    const input = createSemanticExportInput(body);
    await this.audit.record({
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.export.requested",
      resourceType: "semantic_export",
      outcome: "REQUESTED",
      requestId: context.requestId
    });
    const document = await this.exports.create(
      internalProjectContext(request, principal, tenant),
      input
    );
    await recordCommittedAudit(this.audit, this.logger, {
      actorId: principal.userId,
      workspaceId: tenant.workspaceId,
      projectId: tenant.projectId,
      action: "semantic.export.downloaded",
      resourceType: "semantic_export",
      outcome: "SUCCESS",
      requestId: context.requestId
    });
    const bytes = Buffer.from(document.bytes);
    reply
      .header("Cache-Control", "private, no-store")
      .header(
        "Content-Disposition",
        `attachment; filename="${document.filename}"`
      )
      .header("Content-Length", String(bytes.byteLength))
      .header("Content-Type", document.contentType)
      .header("X-Export-Row-Count", String(document.rowCount))
      .send(bytes);
  }
}
