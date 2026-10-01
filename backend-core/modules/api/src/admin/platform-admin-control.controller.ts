import { BadRequestException, Body, Controller, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { parseAdminStateCommand, type AdminStateResult, type ApiResponse } from "@seo-platform/contracts";
import { apiResponse } from "../common/api-response.js";
import { assertUuid } from "../common/identifier.js";
import { requiredVersion } from "../common/version-precondition.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import { CsrfSessionGuard, headerValue } from "../identity/session-auth.guard.js";
import { RequirePlatformRole } from "./platform-role.js";
import { PlatformRoleGuard, type PlatformAdminRequest } from "./platform-role.guard.js";
import { PlatformAdminControlService } from "./platform-admin-control.service.js";

@Controller("admin-api/v1")
@RequirePlatformRole("OPERATIONS")
@UseGuards(CsrfSessionGuard, PlatformRoleGuard)
export class PlatformAdminControlController {
  public constructor(private readonly control: PlatformAdminControlService) {}
  @Patch("workspaces/:id/state")
  public workspace(@Param("id") id: string, @Body() body: unknown, @Req() req: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<ApiResponse<AdminStateResult>> {
    return this.change("WORKSPACE", id, body, req, principal);
  }
  @Patch("users/:id/state")
  public user(@Param("id") id: string, @Body() body: unknown, @Req() req: PlatformAdminRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<ApiResponse<AdminStateResult>> {
    return this.change("USER", id, body, req, principal);
  }
  private async change(kind: "WORKSPACE" | "USER", rawId: string, body: unknown, req: PlatformAdminRequest, principal: AuthenticatedPrincipal): Promise<ApiResponse<AdminStateResult>> {
    const id = assertUuid(rawId, "id");
    let input; try { input = parseAdminStateCommand(body); } catch { throw new BadRequestException("Некорректная команда изменения состояния"); }
    const result = await this.control.changeState(kind, id, input, requiredVersion(headerValue(req, "if-match")), principal.userId, requiredIdempotencyKey(headerValue(req, "idempotency-key")), requestContext(req));
    return apiResponse(req, result, result.version);
  }
}
