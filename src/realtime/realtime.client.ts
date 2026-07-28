import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalUpdateNotificationPreferencesInput,
  InternalUpdateProjectNotificationSubscriptionInput,
  NotificationCollectionResponse,
  NotificationListItem,
  NotificationListQuery,
  NotificationPreferencesSummary,
  NotificationReadAllResult,
  ProjectNotificationSubscriptionSummary,
  UpdateNotificationPreferencesInput,
  UpdateProjectNotificationSubscriptionInput
} from "@seo-platform/contracts";
import type { TenantAuthorization } from "../authorization/authorization.types.js";
import { DomainError } from "../common/domain-error.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  notificationCollectionResponse,
  notificationListItem,
  notificationPreferencesSummary,
  notificationReadAllResult,
  projectNotificationSubscriptionSummary
} from "../notifications/notification-mapper.js";

interface ActorContext {
  readonly actorId: string;
  readonly requestId: string;
}

interface ProjectContext extends ActorContext {
  readonly tenant: TenantAuthorization;
}

@Injectable()
export class RealtimeClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async getNotificationPreferences(
    context: ActorContext
  ): Promise<NotificationPreferencesSummary> {
    const data = await this.request(
      "GET",
      `/internal/v1/users/${encodeURIComponent(context.actorId)}/notification-preferences`,
      context
    );
    return notificationPreferencesSummary(data);
  }

  public async listNotifications(
    context: ActorContext,
    query: NotificationListQuery
  ): Promise<NotificationCollectionResponse> {
    const parameters = new URLSearchParams({
      limit: String(query.limit),
      unreadOnly: String(query.unreadOnly)
    });
    if (query.cursor) parameters.set("cursor", query.cursor);
    const payload = await this.requestPayload(
      "GET",
      `/internal/v1/users/${encodeURIComponent(context.actorId)}/notifications?${parameters.toString()}`,
      context
    );
    return notificationCollectionResponse(payload);
  }

  public async markNotificationRead(
    context: ActorContext,
    notificationId: string
  ): Promise<NotificationListItem> {
    const data = await this.request(
      "PATCH",
      `/internal/v1/users/${encodeURIComponent(context.actorId)}/notifications/${encodeURIComponent(notificationId)}/read`,
      context
    );
    return notificationListItem(data);
  }

  public async markAllNotificationsRead(
    context: ActorContext
  ): Promise<NotificationReadAllResult> {
    const data = await this.request(
      "POST",
      `/internal/v1/users/${encodeURIComponent(context.actorId)}/notifications/read-all`,
      context
    );
    return notificationReadAllResult(data);
  }

  public async updateNotificationPreferences(
    context: ActorContext,
    input: UpdateNotificationPreferencesInput,
    version: number
  ): Promise<NotificationPreferencesSummary> {
    const body: InternalUpdateNotificationPreferencesInput = {
      ...input,
      userId: context.actorId,
      version
    };
    const data = await this.request(
      "PATCH",
      `/internal/v1/users/${encodeURIComponent(context.actorId)}/notification-preferences`,
      context,
      body
    );
    return notificationPreferencesSummary(data);
  }

  public async getProjectNotificationSubscription(
    context: ProjectContext
  ): Promise<ProjectNotificationSubscriptionSummary> {
    const projectId = requiredProjectId(context.tenant);
    const data = await this.request(
      "GET",
      `/internal/v1/projects/${encodeURIComponent(projectId)}/notification-subscription`,
      context
    );
    return projectNotificationSubscriptionSummary(data);
  }

  public async updateProjectNotificationSubscription(
    context: ProjectContext,
    input: UpdateProjectNotificationSubscriptionInput,
    version: number
  ): Promise<ProjectNotificationSubscriptionSummary> {
    const body: InternalUpdateProjectNotificationSubscriptionInput = {
      ...input,
      userId: context.actorId,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      membershipId: requiredMembershipId(context.tenant),
      membershipVersion: requiredMembershipVersion(context.tenant),
      version
    };
    const data = await this.request(
      "PATCH",
      `/internal/v1/projects/${encodeURIComponent(body.projectId)}/notification-subscription`,
      context,
      body
    );
    return projectNotificationSubscriptionSummary(data);
  }

  private async request(
    method: "GET" | "PATCH" | "POST",
    path: string,
    context: ActorContext | ProjectContext,
    body?: unknown
  ): Promise<unknown> {
    const payload = await this.requestPayload(method, path, context, body);
    if (!("data" in payload)) throw invalidResponse();
    return payload.data;
  }

  private async requestPayload(
    method: "GET" | "PATCH" | "POST",
    path: string,
    context: ActorContext | ProjectContext,
    body?: unknown
  ): Promise<Readonly<Record<string, unknown>>> {
    const token = this.config.internalApiToken;
    if (!token) throw dependencyUnavailable();
    const headers = new Headers({
      Accept: "application/json",
      "X-Internal-Token": token,
      "X-Request-Id": context.requestId,
      "X-Actor-Id": context.actorId
    });
    if ("tenant" in context) {
      headers.set("X-Workspace-Id", context.tenant.workspaceId);
      headers.set("X-Project-Id", requiredProjectId(context.tenant));
      headers.set(
        "X-Membership-Id",
        requiredMembershipId(context.tenant)
      );
      headers.set(
        "X-Membership-Version",
        String(requiredMembershipVersion(context.tenant))
      );
    }
    if (body !== undefined) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
      response = await fetch(
        new URL(path, this.config.services.realtime),
        {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.config.dependencyTimeoutMs)
        }
      );
    } catch {
      throw dependencyUnavailable();
    }
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw upstreamError(response.status);
    if (typeof payload !== "object" || payload === null) {
      throw invalidResponse();
    }
    return payload as Readonly<Record<string, unknown>>;
  }
}

function requiredProjectId(tenant: TenantAuthorization): string {
  if (!tenant.projectId) throw new Error("Project authorization is required");
  return tenant.projectId;
}

function requiredMembershipId(tenant: TenantAuthorization): string {
  if (!tenant.membershipId) {
    throw new Error("Membership authorization is required");
  }
  return tenant.membershipId;
}

function requiredMembershipVersion(tenant: TenantAuthorization): number {
  if (!tenant.membershipVersion) {
    throw new Error("Membership version is required");
  }
  return tenant.membershipVersion;
}

function invalidResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Realtime service returned an invalid response",
    retryable: true
  });
}

function dependencyUnavailable(): DomainError {
  return new DomainError({
    statusCode: 503,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Notification settings are temporarily unavailable",
    retryable: true
  });
}

function upstreamError(status: number): DomainError {
  if (status === 404) {
    return new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Notification settings were not found"
    });
  }
  if (status === 409) {
    return new DomainError({
      statusCode: 412,
      code: "VERSION_CONFLICT",
      message: "Notification settings changed in another session"
    });
  }
  if (status === 400 || status === 422) {
    return new DomainError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      message: "Notification settings are invalid"
    });
  }
  return dependencyUnavailable();
}
