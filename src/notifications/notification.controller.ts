import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  NotificationPreferencesSummary,
  ProjectNotificationSubscriptionSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  internalActorContext,
  internalProjectContext,
  internalUuid
} from "../internal/internal-context.js";
import { InternalApiGuard } from "../internal/internal-api.guard.js";
import {
  notificationPreferencesInput,
  projectNotificationSubscriptionInput
} from "./notification-input.js";
import { NotificationService } from "./notification.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1")
@UseGuards(InternalApiGuard)
export class NotificationController {
  public constructor(
    private readonly notifications: NotificationService
  ) {}

  @Get("users/:userId/notification-preferences")
  public async getPreferences(
    @Param("userId") userId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<NotificationPreferencesSummary>> {
    const actor = internalActorContext(headers);
    assertSame(internalUuid(userId, "userId"), actor.actorId, "user");
    return response(
      request,
      await this.notifications.getPreferences(actor.actorId)
    );
  }

  @Patch("users/:userId/notification-preferences")
  public async updatePreferences(
    @Param("userId") userId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<NotificationPreferencesSummary>> {
    const actor = internalActorContext(headers);
    const input = notificationPreferencesInput(body);
    assertSame(internalUuid(userId, "userId"), actor.actorId, "user");
    assertSame(input.userId, actor.actorId, "actor");
    return response(
      request,
      await this.notifications.updatePreferences(input),
      input.version + 1
    );
  }

  @Get("projects/:projectId/notification-subscription")
  public async getProjectSubscription(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectNotificationSubscriptionSummary>> {
    const context = internalProjectContext(headers);
    assertSame(
      internalUuid(projectId, "projectId"),
      context.projectId,
      "project"
    );
    return response(
      request,
      await this.notifications.getProjectSubscription(context)
    );
  }

  @Patch("projects/:projectId/notification-subscription")
  public async updateProjectSubscription(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<ProjectNotificationSubscriptionSummary>> {
    const context = internalProjectContext(headers);
    const input = projectNotificationSubscriptionInput(body);
    assertSame(
      internalUuid(projectId, "projectId"),
      context.projectId,
      "project"
    );
    assertSame(input.userId, context.actorId, "actor");
    assertSame(input.workspaceId, context.workspaceId, "workspace");
    assertSame(input.projectId, context.projectId, "project");
    assertSame(input.membershipId, context.membershipId, "membership");
    if (input.membershipVersion !== context.membershipVersion) {
      throw new BadRequestException(
        "Trusted membership version does not match the command"
      );
    }
    return response(
      request,
      await this.notifications.updateProjectSubscription(input),
      input.version + 1
    );
  }
}

function response<Data>(
  request: FastifyRequest,
  data: Data,
  version?: number
): ApiResponse<Data> {
  return {
    data,
    meta: {
      requestId: request.id,
      ...(version === undefined ? {} : { version })
    }
  };
}

function assertSame(
  actual: string,
  expected: string,
  field: string
): void {
  if (actual !== expected) {
    throw new BadRequestException(
      `Trusted ${field} context does not match the command`
    );
  }
}
