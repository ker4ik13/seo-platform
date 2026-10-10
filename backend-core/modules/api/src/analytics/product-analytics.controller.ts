import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { apiResponse } from "../common/api-response.js";
import { CurrentPrincipal } from "../identity/current-principal.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest,
} from "../identity/identity.types.js";
import { CsrfSessionGuard } from "../identity/session-auth.guard.js";
import { ProductAnalyticsService } from "./product-analytics.service.js";

@Controller("api/v1/analytics")
@UseGuards(CsrfSessionGuard)
export class ProductAnalyticsController {
  public constructor(private readonly analytics: ProductAnalyticsService) {}
  @Post("activity")
  @HttpCode(202)
  public async activity(
    @Body() body: unknown,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() request: AuthenticatedRequest,
  ) {
    return apiResponse(
      request,
      await this.analytics.ingest(principal.userId, body),
    );
  }
}
