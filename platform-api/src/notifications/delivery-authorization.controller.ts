import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalAuthorizeProjectNotificationDeliveryResult
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { apiResponse } from "../common/api-response.js";
import { DomainError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { DeliveryAuthorizationGuard } from "./delivery-authorization.guard.js";
import { deliveryAuthorizationInput } from "./delivery-authorization.input.js";

@Controller("internal/v1/projects/:projectId/notification-deliveries")
@UseGuards(DeliveryAuthorizationGuard)
export class DeliveryAuthorizationController {
  public constructor(
    private readonly authorization: AuthorizationService
  ) {}

  @Post("authorize")
  @HttpCode(HttpStatus.OK)
  public async authorize(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<
    ApiResponse<InternalAuthorizeProjectNotificationDeliveryResult>
  > {
    const input = deliveryAuthorizationInput(body);
    if (assertUuid(projectId, "projectId") !== input.projectId) {
      throw new BadRequestException(
        "Route and notification delivery scope do not match"
      );
    }
    let tenant;
    try {
      tenant = await this.authorization.forProject(
        input.userId,
        input.projectId,
        input.permission
      );
    } catch (error) {
      if (
        error instanceof DomainError &&
        (error.statusCode === 403 || error.statusCode === 404)
      ) {
        return apiResponse(request, {
          authorized: false,
          reason: "ACCESS_REVOKED"
        });
      }
      throw error;
    }
    if (
      tenant.workspaceId !== input.workspaceId ||
      tenant.projectId !== input.projectId ||
      tenant.membershipId !== input.membershipId ||
      tenant.membershipVersion !== input.membershipVersion ||
      tenant.workspaceStatus !== "ACTIVE" ||
      tenant.projectStatus === "ARCHIVED"
    ) {
      return apiResponse(request, {
        authorized: false,
        reason: "SCOPE_CHANGED"
      });
    }
    return apiResponse(request, {
      authorized: true,
      reason: "AUTHORIZED"
    });
  }
}
