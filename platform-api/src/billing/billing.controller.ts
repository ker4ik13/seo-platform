import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiCollectionResponse,
  ApiResponse,
  BillingBalanceSummary,
  BillingLedgerTransactionSummary,
  BillingOrderSummary,
  BillingPaymentMethodSummary,
  BillingPlanSummary,
  BillingRefundSummary,
  BillingSubscriptionSummary,
  NpdReceiptObligationSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import type { TenantRequest } from "../authorization/authorization.types.js";
import { RequirePermission } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import {
  apiResponse,
  collectionResponse
} from "../common/api-response.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
import { assertUuid } from "../common/identifier.js";
import { requiredVersion } from "../common/version-precondition.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type {
  AuthenticatedPrincipal
} from "../identity/identity.types.js";
import { RecentAuthenticationService } from "../identity/recent-authentication.service.js";
import { requestContext } from "../identity/request-context.js";
import {
  CsrfSessionGuard,
  headerValue,
  SessionAuthGuard
} from "../identity/session-auth.guard.js";
import {
  billingCheckoutInput,
  billingRefundInput,
  billingTopUpInput
} from "./billing-input.js";
import { BillingService } from "./billing.service.js";

@Controller("api/v1/billing")
export class BillingCatalogController {
  public constructor(private readonly billing: BillingService) {}

  @Get("plans")
  public async plans(
    @Req() request: FastifyRequest
  ): Promise<ApiCollectionResponse<BillingPlanSummary>> {
    return collectionResponse(request, await this.billing.plans());
  }
}

@Controller("api/v1/workspaces/:workspaceId/billing")
export class BillingController {
  public constructor(
    private readonly billing: BillingService,
    private readonly recentAuthentication: RecentAuthenticationService
  ) {}

  @Get("subscription")
  @RequirePermission("billing.view_plan")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async subscription(
    @Req() request: TenantRequest
  ): Promise<ApiResponse<BillingSubscriptionSummary | null>> {
    return apiResponse(
      request,
      await this.billing.subscription(workspaceId(request))
    );
  }

  @Post("subscription/cancel")
  @HttpCode(200)
  @RequirePermission("billing.manage_plan")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async cancelSubscription(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<BillingSubscriptionSummary>> {
    this.recentAuthentication.assert(principal);
    return apiResponse(
      request,
      await this.billing.cancelSubscription(
        workspaceId(request),
        principal.userId,
        requiredVersion(headerValue(request, "if-match")),
        requestContext(request)
      )
    );
  }

  @Post("trial")
  @RequirePermission("billing.manage_plan")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async startTrial(
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<BillingSubscriptionSummary>> {
    this.recentAuthentication.assert(principal);
    return apiResponse(
      request,
      await this.billing.startTrial(
        workspaceId(request),
        principal.userId,
        idempotencyKey(request),
        requestContext(request)
      )
    );
  }

  @Post("checkout")
  @RequirePermission("billing.manage_plan")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async checkout(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<BillingOrderSummary>> {
    this.recentAuthentication.assert(principal);
    return apiResponse(
      request,
      await this.billing.createCheckout(
        workspaceId(request),
        principal.userId,
        idempotencyKey(request),
        billingCheckoutInput(body),
        requestContext(request)
      )
    );
  }

  @Post("top-ups")
  @RequirePermission("billing.top_up")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async topUp(
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<BillingOrderSummary>> {
    this.recentAuthentication.assert(principal);
    return apiResponse(
      request,
      await this.billing.createTopUp(
        workspaceId(request),
        principal.userId,
        idempotencyKey(request),
        billingTopUpInput(body),
        requestContext(request)
      )
    );
  }

  @Get("orders")
  @RequirePermission("billing.view_transactions")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async orders(
    @Req() request: TenantRequest
  ): Promise<ApiCollectionResponse<BillingOrderSummary>> {
    return collectionResponse(
      request,
      await this.billing.listOrders(workspaceId(request))
    );
  }

  @Post("orders/:orderId/refresh")
  @HttpCode(200)
  @RequirePermission("billing.view_transactions")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async refreshOrder(
    @Param("orderId") orderId: string,
    @Req() request: TenantRequest
  ): Promise<ApiResponse<BillingOrderSummary>> {
    return apiResponse(
      request,
      await this.billing.refreshOrder(
        workspaceId(request),
        assertUuid(orderId, "orderId")
      )
    );
  }

  @Get("balance")
  @RequirePermission("billing.view_balance")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async balance(
    @Req() request: TenantRequest
  ): Promise<ApiResponse<BillingBalanceSummary>> {
    return apiResponse(
      request,
      await this.billing.balance(workspaceId(request))
    );
  }

  @Get("ledger")
  @RequirePermission("billing.view_transactions")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async ledger(
    @Req() request: TenantRequest
  ): Promise<ApiCollectionResponse<BillingLedgerTransactionSummary>> {
    return collectionResponse(
      request,
      await this.billing.transactions(workspaceId(request))
    );
  }

  @Get("payment-methods")
  @RequirePermission("billing.manage_payment_methods")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async paymentMethods(
    @Req() request: TenantRequest
  ): Promise<ApiCollectionResponse<BillingPaymentMethodSummary>> {
    return collectionResponse(
      request,
      await this.billing.paymentMethods(workspaceId(request))
    );
  }

  @Delete("payment-methods/:methodId")
  @RequirePermission("billing.manage_payment_methods")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async disablePaymentMethod(
    @Param("methodId") methodId: string,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<BillingPaymentMethodSummary>> {
    this.recentAuthentication.assert(principal);
    return apiResponse(
      request,
      await this.billing.disablePaymentMethod(
        workspaceId(request),
        assertUuid(methodId, "methodId"),
        principal.userId,
        requiredVersion(headerValue(request, "if-match")),
        requestContext(request)
      )
    );
  }

  @Get("receipts")
  @RequirePermission("billing.view_invoices")
  @UseGuards(SessionAuthGuard, TenantPermissionGuard)
  public async receipts(
    @Req() request: TenantRequest
  ): Promise<ApiCollectionResponse<NpdReceiptObligationSummary>> {
    return collectionResponse(
      request,
      await this.billing.receipts(workspaceId(request))
    );
  }

  @Post("payments/:paymentId/refunds")
  @RequirePermission("billing.manage_plan")
  @UseGuards(CsrfSessionGuard, TenantPermissionGuard)
  public async refund(
    @Param("paymentId") paymentId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<ApiResponse<BillingRefundSummary>> {
    this.recentAuthentication.assert(principal);
    return apiResponse(
      request,
      await this.billing.createRefund(
        workspaceId(request),
        assertUuid(paymentId, "paymentId"),
        principal.userId,
        idempotencyKey(request),
        billingRefundInput(body),
        requestContext(request)
      )
    );
  }
}

function workspaceId(request: TenantRequest): string {
  const id = request.tenantAuthorization?.workspaceId;
  if (!id) throw new Error("Workspace authorization is missing");
  return id;
}

function idempotencyKey(request: FastifyRequest): string {
  return requiredIdempotencyKey(
    headerValue(request, "idempotency-key")
  );
}
