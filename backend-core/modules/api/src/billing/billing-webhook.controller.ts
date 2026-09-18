import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { yookassaWebhookInput } from "./billing-input.js";
import { BillingService } from "./billing.service.js";

@Controller("api/v1/billing/providers/yookassa")
export class BillingWebhookController {
  public constructor(private readonly billing: BillingService) {}

  @Post("webhook")
  @HttpCode(200)
  public async webhook(
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<{ readonly received: true }> {
    await this.billing.processWebhook(
      yookassaWebhookInput(body),
      request.ip,
      false,
      request.id
    );
    return { received: true };
  }
}
