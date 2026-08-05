import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalAuthEmailCompletionReceiptV1,
  InternalAuthEmailMaterialDecisionV1
} from "@seo-platform/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  authEmailCompletionInput,
  authEmailEventId,
  emptyAuthEmailMaterialInput,
  requiredAuthEmailRequestId
} from "./auth-email-delivery-input.js";
import { AuthEmailDeliveryGuard } from "./auth-email-delivery.guard.js";
import { AuthEmailDeliveryService } from "./auth-email-delivery.service.js";

@Controller("internal/v1/auth-email-deliveries")
@UseGuards(AuthEmailDeliveryGuard)
export class AuthEmailDeliveryController {
  public constructor(
    private readonly deliveries: AuthEmailDeliveryService
  ) {}

  @Post(":eventId/material")
  @HttpCode(HttpStatus.OK)
  public async material(
    @Param("eventId") eventIdValue: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<InternalAuthEmailMaterialDecisionV1>> {
    reply.header("Cache-Control", "no-store");
    const requestId = requiredAuthEmailRequestId(request);
    const eventId = authEmailEventId(eventIdValue);
    emptyAuthEmailMaterialInput(body);
    return {
      data: await this.deliveries.material(eventId),
      meta: { requestId }
    };
  }

  @Post(":eventId/complete")
  @HttpCode(HttpStatus.OK)
  public async complete(
    @Param("eventId") eventIdValue: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiResponse<InternalAuthEmailCompletionReceiptV1>> {
    reply.header("Cache-Control", "no-store");
    const requestId = requiredAuthEmailRequestId(request);
    const eventId = authEmailEventId(eventIdValue);
    const completion = authEmailCompletionInput(body);
    if (completion.eventId !== eventId) {
      throw new BadRequestException(
        "Route and auth-email completion event do not match"
      );
    }
    return {
      data: await this.deliveries.complete(eventId, completion.outcome),
      meta: { requestId }
    };
  }
}
