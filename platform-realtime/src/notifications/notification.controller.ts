import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  InternalCreateProjectNotificationReceipt,
  NotificationCollectionResponse,
  NotificationListItem,
  NotificationPreferencesSummary,
  NotificationReadAllResult,
  ProjectNotificationSubscriptionSummary
} from "@seo-platform/contracts";
import type { FastifyRequest } from "fastify";
import {
  internalActorContext,
  internalProjectContext,
  internalUuid
} from "../internal/internal-context.js";
import { PlatformApiGuard } from "../internal/platform-api.guard.js";
import {
  createProjectNotificationInput,
  notificationPreferencesInput,
  projectNotificationSubscriptionInput
} from "./notification-input.js";
import { notificationListQuery } from "./notification-center-query.js";
import { NotificationCenterService } from "./notification-center.service.js";
import { NotificationService } from "./notification.service.js";

type InternalHeaders = Readonly<
  Record<string, string | string[] | undefined>
>;

@Controller("internal/v1")
@UseGuards(PlatformApiGuard)
export class NotificationController {
  public constructor(
    private readonly center: NotificationCenterService,
    private readonly notifications: NotificationService
  ) {}

  @Get("users/:userId/notifications")
  public async listNotifications(
    @Param("userId") userId: string,
    @Headers() headers: InternalHeaders,
    @Query() query: unknown,
    @Req() request: FastifyRequest
  ): Promise<NotificationCollectionResponse> {
    const actor = internalActorContext(headers);
    assertSame(internalUuid(userId, "userId"), actor.actorId, "user");
    return this.center.list(
      actor.actorId,
      notificationListQuery(query),
      request.id
    );
  }

  @Patch("users/:userId/notifications/:notificationId/read")
  public async markNotificationRead(
    @Param("userId") userId: string,
    @Param("notificationId") notificationId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<NotificationListItem>> {
    const actor = internalActorContext(headers);
    assertSame(internalUuid(userId, "userId"), actor.actorId, "user");
    return response(
      request,
      await this.center.markRead(
        actor.actorId,
        internalUuid(notificationId, "notificationId")
      )
    );
  }

  @Post("users/:userId/notifications/read-all")
  public async markAllNotificationsRead(
    @Param("userId") userId: string,
    @Headers() headers: InternalHeaders,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<NotificationReadAllResult>> {
    const actor = internalActorContext(headers);
    assertSame(internalUuid(userId, "userId"), actor.actorId, "user");
    return response(
      request,
      await this.center.markAllRead(actor.actorId)
    );
  }

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

  @Post("projects/:projectId/notifications")
  public async createProjectNotification(
    @Param("projectId") projectId: string,
    @Headers() headers: InternalHeaders,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<ApiResponse<InternalCreateProjectNotificationReceipt>> {
    const context = internalProjectContext(headers);
    const input = createProjectNotificationInput(body);
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
      await this.notifications.createProjectNotification(context, input)
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
