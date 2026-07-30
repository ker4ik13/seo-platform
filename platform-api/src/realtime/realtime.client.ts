import { Inject, Injectable } from "@nestjs/common";
import type {
  ErrorCode,
  InternalRenameWebPushDeviceInput,
  InternalUpsertWebPushSubscriptionInput,
  InternalUpdateNotificationPreferencesInput,
  InternalUpdateProjectNotificationSubscriptionInput,
  NotificationCollectionResponse,
  NotificationListItem,
  NotificationListQuery,
  NotificationPreferencesSummary,
  NotificationReadAllResult,
  ProjectNotificationSubscriptionSummary,
  RenameWebPushDeviceInput,
  UpsertWebPushSubscriptionInput,
  UpdateNotificationPreferencesInput,
  UpdateProjectNotificationSubscriptionInput,
  WebPushBrowser,
  WebPushDeviceSummary,
  WebPushPlatform,
  WebPushRevokeResult,
  WebPushSubscriptionsState
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
import {
  webPushDeviceSummary,
  webPushRevokeResult,
  webPushSubscriptionsState
} from "../notifications/web-push-mapper.js";

interface ActorContext {
  readonly actorId: string;
  readonly requestId: string;
}

interface ProjectContext extends ActorContext {
  readonly tenant: TenantAuthorization;
}

interface PushActorContext extends ActorContext {
  readonly sessionFamilyId: string;
}

interface WebPushUpsertMetadata {
  readonly browser: WebPushBrowser;
  readonly platform: WebPushPlatform;
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

  public async getWebPushSubscriptions(
    context: PushActorContext
  ): Promise<WebPushSubscriptionsState> {
    const { data } = await this.pushRequest(
      "GET",
      `/internal/v1/users/${encodeURIComponent(context.actorId)}/push-subscriptions`,
      context
    );
    return webPushSubscriptionsState(data);
  }

  public async upsertWebPushSubscription(
    context: PushActorContext,
    installationId: string,
    input: UpsertWebPushSubscriptionInput & WebPushUpsertMetadata
  ): Promise<WebPushDeviceSummary> {
    const body: InternalUpsertWebPushSubscriptionInput = {
      ...input,
      userId: context.actorId,
      sessionFamilyId: context.sessionFamilyId
    };
    const ownerResponse = await this.pushRequest(
      "PUT",
      `/internal/v1/users/${encodeURIComponent(context.actorId)}/push-subscriptions/${encodeURIComponent(installationId)}`,
      context,
      body
    );
    const result = webPushDeviceSummary(ownerResponse.data);
    if (ownerResponse.version !== result.version) {
      throw invalidResponse();
    }
    return result;
  }

  public async renameWebPushDevice(
    context: PushActorContext,
    installationId: string,
    input: RenameWebPushDeviceInput,
    version: number
  ): Promise<WebPushDeviceSummary> {
    const body: InternalRenameWebPushDeviceInput = {
      ...input,
      userId: context.actorId,
      version
    };
    const ownerResponse = await this.pushRequest(
      "PATCH",
      `/internal/v1/users/${encodeURIComponent(context.actorId)}/push-subscriptions/${encodeURIComponent(installationId)}`,
      context,
      body
    );
    const result = webPushDeviceSummary(ownerResponse.data);
    if (ownerResponse.version !== result.version) {
      throw invalidResponse();
    }
    return result;
  }

  public async revokeWebPushDevice(
    context: PushActorContext,
    installationId: string
  ): Promise<WebPushRevokeResult> {
    const { data } = await this.pushRequest(
      "DELETE",
      `/internal/v1/users/${encodeURIComponent(context.actorId)}/push-subscriptions/${encodeURIComponent(installationId)}`,
      context
    );
    return webPushRevokeResult(data);
  }

  private async request(
    method: HttpMethod,
    path: string,
    context: ActorContext | ProjectContext,
    body?: unknown
  ): Promise<unknown> {
    const payload = await this.requestPayload(method, path, context, body);
    if (!("data" in payload)) throw invalidResponse();
    return payload.data;
  }

  private async pushRequest(
    method: HttpMethod,
    path: string,
    context: PushActorContext,
    body?: unknown
  ): Promise<PushOwnerResponse> {
    const payload = await this.requestPayload(
      method,
      path,
      context,
      body,
      "PUSH"
    );
    return pushOwnerResponse(payload, method);
  }

  private async requestPayload(
    method: HttpMethod,
    path: string,
    context: ActorContext | ProjectContext | PushActorContext,
    body?: unknown,
    credential: "SHARED" | "PUSH" = "SHARED"
  ): Promise<Readonly<Record<string, unknown>>> {
    const token =
      credential === "PUSH"
        ? this.config.realtimeNotificationApiToken
        : this.config.realtimeApiToken;
    if (!token) {
      if (credential === "PUSH") throw webPushUnavailable();
      throw dependencyUnavailable();
    }
    const headers = new Headers({
      Accept: "application/json",
      "X-Internal-Token": token,
      "X-Request-Id": context.requestId,
      "X-Actor-Id": context.actorId
    });
    if (credential === "PUSH" && "sessionFamilyId" in context) {
      headers.set("X-Session-Family-Id", context.sessionFamilyId);
    }
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
          redirect: "error",
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.config.dependencyTimeoutMs)
        }
      );
    } catch {
      throw dependencyUnavailable();
    }
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      if (credential === "PUSH") {
        throw pushUpstreamError(response.status, payload);
      }
      throw upstreamError(response.status);
    }
    if (typeof payload !== "object" || payload === null) {
      throw invalidResponse();
    }
    return payload as Readonly<Record<string, unknown>>;
  }
}

type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

interface PushOwnerResponse {
  readonly data: unknown;
  readonly version?: number;
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

function webPushUnavailable(): DomainError {
  return new DomainError({
    statusCode: 503,
    code: "WEB_PUSH_UNAVAILABLE",
    message: "Browser notification registration is unavailable",
    retryable: false
  });
}

function pushUpstreamError(
  status: number,
  payload: unknown
): DomainError {
  const code = upstreamErrorCode(payload);
  if (status === 401 && code === "UNAUTHENTICATED") {
    return new DomainError({
      statusCode: 401,
      code,
      message: "The session used for browser notifications was revoked",
      retryable: false
    });
  }
  if (status === 404 && code === "NOT_FOUND") {
    return new DomainError({
      statusCode: 404,
      code,
      message: "Browser notification device was not found"
    });
  }
  if (status === 400 || status === 422) {
    return new DomainError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      message: "Web Push subscription is invalid"
    });
  }
  if (status === 409 && code === "VERSION_CONFLICT") {
    return new DomainError({
      statusCode: 412,
      code,
      message: "Browser notification device changed in another session"
    });
  }
  if (
    status === 409 &&
    code === "VAPID_KEY_VERSION_CHANGED"
  ) {
    return new DomainError({
      statusCode: 409,
      code,
      message: "Browser notification key changed; recreate the subscription"
    });
  }
  if (
    status === 409 &&
    code === "PUSH_SUBSCRIPTION_ALREADY_BOUND"
  ) {
    return new DomainError({
      statusCode: 409,
      code,
      message: "This browser subscription must be recreated"
    });
  }
  if (
    status === 409 &&
    code === "PUSH_DEVICE_LIMIT_REACHED"
  ) {
    return new DomainError({
      statusCode: 409,
      code,
      message: "The active browser notification device limit was reached"
    });
  }
  if (
    status === 409 &&
    code === "EXPLICIT_ENABLE_REQUIRED"
  ) {
    return new DomainError({
      statusCode: 409,
      code,
      message: "Browser notifications require an explicit enable action"
    });
  }
  if (status === 503 && code === "WEB_PUSH_UNAVAILABLE") {
    return webPushUnavailable();
  }
  return dependencyUnavailable();
}

function upstreamErrorCode(payload: unknown): ErrorCode | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return undefined;
  }
  const root = payload as Readonly<Record<string, unknown>>;
  const nested = root.error;
  const source =
    typeof nested === "object" &&
    nested !== null &&
    !Array.isArray(nested)
      ? (nested as Readonly<Record<string, unknown>>)
      : root;
  if (typeof source.code !== "string") {
    return undefined;
  }
  const allowedCodes: readonly ErrorCode[] = [
    "VALIDATION_FAILED",
    "UNAUTHENTICATED",
    "NOT_FOUND",
    "VERSION_CONFLICT",
    "VAPID_KEY_VERSION_CHANGED",
    "PUSH_SUBSCRIPTION_ALREADY_BOUND",
    "PUSH_DEVICE_LIMIT_REACHED",
    "EXPLICIT_ENABLE_REQUIRED",
    "WEB_PUSH_UNAVAILABLE"
  ];
  return allowedCodes.find((candidate) => candidate === source.code);
}

function pushOwnerResponse(
  payload: Readonly<Record<string, unknown>>,
  method: HttpMethod
): PushOwnerResponse {
  if (
    !hasExactKeys(payload, ["data", "meta"]) ||
    typeof payload.meta !== "object" ||
    payload.meta === null ||
    Array.isArray(payload.meta)
  ) {
    throw invalidResponse();
  }
  const meta = payload.meta as Readonly<Record<string, unknown>>;
  const versioned = method === "PUT" || method === "PATCH";
  if (
    !hasExactKeys(
      meta,
      versioned ? ["requestId", "version"] : ["requestId"]
    ) ||
    typeof meta.requestId !== "string" ||
    meta.requestId.length < 1 ||
    meta.requestId.length > 200 ||
    // oxlint-disable-next-line no-control-regex -- This boundary intentionally rejects C0 and DEL characters.
    /[\u0000-\u001f\u007f]/u.test(meta.requestId) ||
    (versioned &&
      (!Number.isSafeInteger(meta.version) ||
        Number(meta.version) < 1))
  ) {
    throw invalidResponse();
  }
  return {
    data: payload.data,
    ...(versioned ? { version: Number(meta.version) } : {})
  };
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key))
  );
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
