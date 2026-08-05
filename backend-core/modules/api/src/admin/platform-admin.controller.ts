import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  AdminNpdReceiptDetail,
  AdminNpdReceiptListPage,
  AdminNpdReceiptSummary,
  ApiCollectionResponse,
  ApiResponse,
  PlatformAdminProfile,
  PlatformStaffRoleAssignmentSummary
} from "@seo-platform/contracts";
import { apiResponse, collectionResponse } from "../common/api-response.js";
import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { requiredVersion } from "../common/version-precondition.js";
import {
  NpdReceiptStatus
} from "../generated/prisma/client.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type {
  AuthenticatedPrincipal
} from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import {
  assignPlatformStaffRoleInput,
  cancelManualNpdReceiptInput,
  registerManualNpdReceiptInput,
  replaceManualNpdReceiptInput,
  revokePlatformStaffRoleInput
} from "./platform-admin-input.js";
import { PlatformAdminService } from "./platform-admin.service.js";
import { RequirePlatformRole } from "./platform-role.js";
import {
  PlatformRoleGuard,
  type PlatformAdminRequest
} from "./platform-role.guard.js";

@Controller("admin-api/v1")
@UseGuards(SessionAuthGuard, PlatformRoleGuard)
export class PlatformAdminProfileController {
  public constructor(private readonly admin: PlatformAdminService) {}

  @Get("me")
  public async me(
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<PlatformAdminProfile>> {
    return apiResponse(
      request,
      await this.admin.profile(principal, request.platformRoles ?? [])
    );
  }
}

@Controller("admin-api/v1/billing/npd-receipts")
@RequirePlatformRole("FINANCE")
export class PlatformAdminNpdController {
  public constructor(private readonly admin: PlatformAdminService) {}

  @Get()
  @UseGuards(SessionAuthGuard, PlatformRoleGuard)
  public async list(
    @Query("cursor") cursor: string | undefined,
    @Query("status") status: string | undefined,
    @Req() request: PlatformAdminRequest
  ): Promise<ApiResponse<AdminNpdReceiptListPage>> {
    return apiResponse(
      request,
      await this.admin.listNpdReceipts(
        cursor ? assertUuid(cursor, "cursor") : undefined,
        npdStatus(status)
      )
    );
  }

  @Get(":receiptId")
  @UseGuards(SessionAuthGuard, PlatformRoleGuard)
  public async detail(
    @Param("receiptId") receiptId: string,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<AdminNpdReceiptDetail>> {
    return apiResponse(
      request,
      await this.admin.npdReceipt(
        assertUuid(receiptId, "receiptId"),
        principal.userId,
        requestContext(request)
      )
    );
  }

  @Post(":receiptId/register-manual")
  @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async register(
    @Param("receiptId") receiptId: string,
    @Body() body: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<AdminNpdReceiptSummary>> {
    return apiResponse(
      request,
      await this.admin.registerManualNpdReceipt(
        assertUuid(receiptId, "receiptId"),
        requiredVersion(headerValue(request, "if-match")),
        registerManualNpdReceiptInput(body),
        principal.userId,
        requestContext(request)
      )
    );
  }

  @Post(":receiptId/cancel-manual")
  @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async cancel(
    @Param("receiptId") receiptId: string,
    @Body() body: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<AdminNpdReceiptSummary>> {
    return apiResponse(
      request,
      await this.admin.cancelManualNpdReceipt(
        assertUuid(receiptId, "receiptId"),
        requiredVersion(headerValue(request, "if-match")),
        cancelManualNpdReceiptInput(body),
        principal.userId,
        requestContext(request)
      )
    );
  }

  @Post(":receiptId/replace-manual")
  @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async replace(
    @Param("receiptId") receiptId: string,
    @Body() body: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<AdminNpdReceiptSummary>> {
    return apiResponse(
      request,
      await this.admin.replaceManualNpdReceipt(
        assertUuid(receiptId, "receiptId"),
        requiredVersion(headerValue(request, "if-match")),
        replaceManualNpdReceiptInput(body),
        principal.userId,
        requestContext(request)
      )
    );
  }
}

@Controller("admin-api/v1/staff/roles")
@RequirePlatformRole("SUPER_ADMIN")
export class PlatformAdminStaffRoleController {
  public constructor(private readonly admin: PlatformAdminService) {}

  @Get()
  @UseGuards(SessionAuthGuard, PlatformRoleGuard)
  public async list(
    @Req() request: PlatformAdminRequest
  ): Promise<ApiCollectionResponse<PlatformStaffRoleAssignmentSummary>> {
    return collectionResponse(request, await this.admin.listStaffRoles());
  }

  @Post()
  @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async assign(
    @Body() body: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<PlatformStaffRoleAssignmentSummary>> {
    return apiResponse(
      request,
      await this.admin.assignStaffRole(
        assignPlatformStaffRoleInput(body),
        principal.userId,
        requestContext(request)
      )
    );
  }

  @Post(":assignmentId/revoke")
  @UseGuards(CsrfSessionGuard, PlatformRoleGuard)
  public async revoke(
    @Param("assignmentId") assignmentId: string,
    @Body() body: unknown,
    @Req() request: PlatformAdminRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<PlatformStaffRoleAssignmentSummary>> {
    return apiResponse(
      request,
      await this.admin.revokeStaffRole(
        assertUuid(assignmentId, "assignmentId"),
        requiredVersion(headerValue(request, "if-match")),
        revokePlatformStaffRoleInput(body),
        principal.userId,
        requestContext(request)
      )
    );
  }
}

function npdStatus(value: string | undefined): NpdReceiptStatus | undefined {
  if (!value) return undefined;
  if (!Object.values(NpdReceiptStatus).includes(value as NpdReceiptStatus)) {
    throw validationError(
      "status",
      "INVALID_ENUM",
      "Unknown NPD receipt status"
    );
  }
  return value as NpdReceiptStatus;
}
