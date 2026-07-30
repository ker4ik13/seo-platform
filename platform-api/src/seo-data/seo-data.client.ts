import { Inject, Injectable } from "@nestjs/common";
import {
  semanticKeywordSourceModes,
  type ApiCollectionResponse,
  type CreateTrackingContextInput,
  type InternalChangeTrackingContextKeywordInput,
  type InternalChangeTrackingContextStatusInput,
  type InternalCreateTrackingContextInput,
  type InternalUpdateTrackingContextInput,
  type KeywordListQuery,
  type RankHistoryQuery,
  type SemanticKeywordListItem,
  type TrackingContextCollection,
  type TrackingContextKeywordAssignmentState,
  type TrackingContextKeywordQuery,
  type TrackingContextSummary,
  type UpdateTrackingContextInput
} from "@seo-platform/contracts";
import type { TenantAuthorization } from "../authorization/authorization.types.js";
import { DomainError } from "../common/domain-error.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  rankHistoryPage as validateRankHistoryPage,
  type RankHistoryPage
} from "../rankings/rank-history-response.js";
import {
  scopedTrackingContext,
  scopedTrackingContextKeywordState,
  trackingContextCollection,
  trackingContextKeywordPage,
  type TrackingContextKeywordPage
} from "../rankings/tracking-context-response.js";

interface InternalContext {
  readonly tenant: TenantAuthorization;
  readonly actorId: string;
  readonly requestId: string;
}

interface KeywordPage {
  readonly data: readonly SemanticKeywordListItem[];
  readonly page: ApiCollectionResponse<SemanticKeywordListItem>["page"];
}

@Injectable()
export class SeoDataClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async listKeywords(
    context: InternalContext,
    query: KeywordListQuery
  ): Promise<KeywordPage> {
    const projectId = requiredProjectId(context.tenant);
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(projectId)}/keywords`,
      this.config.services.seoData
    );
    url.searchParams.set("limit", String(query.limit));
    if (query.cursor) url.searchParams.set("cursor", query.cursor);
    if (query.search) url.searchParams.set("search", query.search);

    const payload = await this.request("GET", url, context);
    return semanticKeywordPage(payload);
  }

  public async listRankHistory(
    context: InternalContext,
    query: RankHistoryQuery
  ): Promise<RankHistoryPage> {
    const scope = trackingScope(context);
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(
        scope.projectId
      )}/rank-history`,
      this.config.services.seoData
    );
    url.searchParams.set("observedFrom", query.observedFrom);
    url.searchParams.set("observedBefore", query.observedBefore);
    if (query.trackingContextId) {
      url.searchParams.set(
        "trackingContextId",
        query.trackingContextId
      );
    }
    if (query.keywordId) {
      url.searchParams.set("keywordId", query.keywordId);
    }
    url.searchParams.set("limit", String(query.limit));
    if (query.cursor) url.searchParams.set("cursor", query.cursor);

    const payload = await this.request("GET", url, context);
    return validateRankHistoryPage(
      payload,
      scope.workspaceId,
      scope.projectId,
      query
    );
  }

  public async listTrackingContexts(
    context: InternalContext
  ): Promise<TrackingContextCollection> {
    const scope = trackingScope(context);
    const payload = await this.request(
      "GET",
      trackingContextUrl(context, this.config.services.seoData),
      context
    );
    return trackingContextCollection(
      responseData(payload),
      scope.workspaceId,
      scope.projectId
    );
  }

  public async getTrackingContext(
    context: InternalContext,
    contextId: string
  ): Promise<TrackingContextSummary> {
    const scope = trackingScope(context);
    const payload = await this.request(
      "GET",
      trackingContextUrl(
        context,
        this.config.services.seoData,
        contextId
      ),
      context
    );
    return scopedTrackingContext(
      responseData(payload),
      scope.workspaceId,
      scope.projectId,
      contextId
    );
  }

  public async createTrackingContext(
    context: InternalContext,
    input: CreateTrackingContextInput,
    idempotencyKey: string
  ): Promise<TrackingContextSummary> {
    const scope = trackingScope(context);
    const body: InternalCreateTrackingContextInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      idempotencyKey
    };
    const payload = await this.request(
      "POST",
      trackingContextUrl(context, this.config.services.seoData),
      context,
      body
    );
    return scopedTrackingContext(
      responseData(payload),
      scope.workspaceId,
      scope.projectId
    );
  }

  public async updateTrackingContext(
    context: InternalContext,
    contextId: string,
    input: UpdateTrackingContextInput,
    version: number
  ): Promise<TrackingContextSummary> {
    const scope = trackingScope(context);
    const body: InternalUpdateTrackingContextInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    const payload = await this.request(
      "PATCH",
      trackingContextUrl(
        context,
        this.config.services.seoData,
        contextId
      ),
      context,
      body
    );
    return scopedTrackingContext(
      responseData(payload),
      scope.workspaceId,
      scope.projectId,
      contextId
    );
  }

  public changeTrackingContextStatus(
    context: InternalContext,
    contextId: string,
    status: "archive" | "restore",
    version: number
  ): Promise<TrackingContextSummary> {
    const scope = trackingScope(context);
    const body: InternalChangeTrackingContextStatusInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    return this.request(
      "POST",
      trackingContextUrl(
        context,
        this.config.services.seoData,
        `${contextId}/${status}`
      ),
      context,
      body
    ).then((payload) =>
      scopedTrackingContext(
        responseData(payload),
        scope.workspaceId,
        scope.projectId,
        contextId
      )
    );
  }

  public async listTrackingContextKeywords(
    context: InternalContext,
    contextId: string,
    query: TrackingContextKeywordQuery
  ): Promise<TrackingContextKeywordPage> {
    const url = trackingContextUrl(
      context,
      this.config.services.seoData,
      `${contextId}/keywords`
    );
    url.searchParams.set("limit", String(query.limit));
    if (query.cursor) url.searchParams.set("cursor", query.cursor);
    if (query.search) url.searchParams.set("search", query.search);
    const payload = await this.request("GET", url, context);
    return trackingContextKeywordPage(
      payload,
      contextId
    );
  }

  public async changeTrackingContextKeyword(
    context: InternalContext,
    contextId: string,
    keywordId: string,
    assigned: boolean
  ): Promise<TrackingContextKeywordAssignmentState> {
    const scope = trackingScope(context);
    const body: InternalChangeTrackingContextKeywordInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      contextId,
      keywordId,
      actorId: context.actorId
    };
    const payload = await this.request(
      assigned ? "PUT" : "DELETE",
      trackingContextUrl(
        context,
        this.config.services.seoData,
        `${contextId}/keywords/${keywordId}`
      ),
      context,
      body
    );
    return scopedTrackingContextKeywordState(
      responseData(payload),
      contextId,
      keywordId,
      assigned
    );
  }

  private async request(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: URL,
    context: InternalContext,
    body?: unknown
  ): Promise<unknown> {
    const token = this.config.seoDataApiToken;
    if (!token) throw dependencyUnavailable();

    const headers = new Headers({
      Accept: "application/json",
      "X-Internal-Token": token,
      "X-Request-Id": context.requestId,
      "X-Workspace-Id": context.tenant.workspaceId,
      "X-Project-Id": requiredProjectId(context.tenant),
      "X-Actor-Id": context.actorId
    });
    if (body !== undefined) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        redirect: "error",
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(
          method === "GET"
            ? this.config.dependencyTimeoutMs
            : this.config.internalCommandTimeoutMs
        )
      });
    } catch {
      throw dependencyUnavailable();
    }

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw upstreamError(response.status, payload);
    }
    return payload;
  }
}

export function semanticKeywordPage(payload: unknown): KeywordPage {
  const response = objectValue(payload);
  const data = response?.data;
  const page = objectValue(response?.page);
  if (
    !Array.isArray(data) ||
    !page ||
    typeof page.hasNext !== "boolean" ||
    (page.nextCursor !== undefined &&
      typeof page.nextCursor !== "string") ||
    (page.totalApprox !== undefined &&
      (!Number.isSafeInteger(page.totalApprox) ||
        Number(page.totalApprox) < 0))
  ) {
    throw invalidResponse();
  }

  const items = data.map(keywordItem);
  return {
    data: items,
    page: {
      hasNext: page.hasNext,
      ...(typeof page.nextCursor === "string"
        ? { nextCursor: page.nextCursor }
        : {}),
      ...(typeof page.totalApprox === "number"
        ? { totalApprox: page.totalApprox }
        : {})
    }
  };
}

function keywordItem(value: unknown): SemanticKeywordListItem {
  const item = objectValue(value);
  if (!item) throw invalidResponse();

  const tags = item.tags;
  const sourceMode = item.sourceMode;
  if (
    !requiredString(item.id) ||
    !requiredString(item.textOriginal) ||
    !requiredString(item.textNormalized) ||
    !requiredString(item.language) ||
    !Number.isSafeInteger(item.priority) ||
    typeof item.isTracked !== "boolean" ||
    (item.groupPath !== undefined && typeof item.groupPath !== "string") ||
    (item.targetUrl !== undefined && typeof item.targetUrl !== "string") ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string") ||
    typeof item.tagsTruncated !== "boolean" ||
    typeof sourceMode !== "string" ||
    !semanticKeywordSourceModes.some((mode) => mode === sourceMode) ||
    !validDate(item.createdAt) ||
    !validDate(item.updatedAt) ||
    !Number.isSafeInteger(item.version) ||
    Number(item.version) < 1
  ) {
    throw invalidResponse();
  }

  return {
    id: item.id,
    textOriginal: item.textOriginal,
    textNormalized: item.textNormalized,
    language: item.language,
    priority: item.priority as number,
    isTracked: item.isTracked,
    ...(typeof item.groupPath === "string"
      ? { groupPath: item.groupPath }
      : {}),
    ...(typeof item.targetUrl === "string"
      ? { targetUrl: item.targetUrl }
      : {}),
    tags: tags as string[],
    tagsTruncated: item.tagsTruncated,
    sourceMode:
      sourceMode as SemanticKeywordListItem["sourceMode"],
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    version: item.version as number
  };
}

function objectValue(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function requiredString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function requiredProjectId(tenant: TenantAuthorization): string {
  if (!tenant.projectId) {
    throw new Error("Project authorization is required");
  }
  return tenant.projectId;
}

function trackingScope(context: InternalContext): {
  readonly workspaceId: string;
  readonly projectId: string;
} {
  return {
    workspaceId: context.tenant.workspaceId,
    projectId: requiredProjectId(context.tenant)
  };
}

function trackingContextUrl(
  context: InternalContext,
  baseUrl: string,
  suffix?: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  const base = `/internal/v1/projects/${encodeURIComponent(
    projectId
  )}/tracking-contexts`;
  const encodedSuffix = suffix
    ?.split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return new URL(
    encodedSuffix ? `${base}/${encodedSuffix}` : base,
    baseUrl
  );
}

function responseData(payload: unknown): unknown {
  const response = exactRecord(payload, ["data", "meta"]);
  if (!Object.hasOwn(response, "data")) throw invalidResponse();
  apiMeta(response.meta);
  return response.data;
}

function apiMeta(value: unknown): void {
  const meta = exactRecord(value, ["requestId", "version"]);
  if (
    typeof meta.requestId !== "string" ||
    meta.requestId.length < 1 ||
    (meta.version !== undefined &&
      (!Number.isSafeInteger(meta.version) ||
        Number(meta.version) < 1))
  ) {
    throw invalidResponse();
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = objectValue(value);
  if (
    !input ||
    Object.keys(input).some((key) => !keys.includes(key))
  ) {
    throw invalidResponse();
  }
  return input;
}

function invalidResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO data service returned an invalid response",
    retryable: true
  });
}

function dependencyUnavailable(): DomainError {
  return new DomainError({
    statusCode: 503,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO data service is temporarily unavailable",
    retryable: true
  });
}

function upstreamError(status: number, payload: unknown): DomainError {
  if (status === 404) {
    return new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Resource not found"
    });
  }
  if (status === 409) {
    const code = upstreamErrorCode(payload);
    if (code === "IDEMPOTENCY_CONFLICT") {
      return new DomainError({
        statusCode: 409,
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key was already used for another request"
      });
    }
    if (code === "DUPLICATE") {
      return new DomainError({
        statusCode: 409,
        code: "DUPLICATE",
        message: "A tracking context with these values already exists"
      });
    }
    return new DomainError({
      statusCode: 409,
      code: "RESOURCE_STATE_CONFLICT",
      message: "Resource state does not allow this operation"
    });
  }
  if (status === 412) {
    const currentVersion = upstreamCurrentVersion(payload);
    return new DomainError({
      statusCode: 412,
      code: "VERSION_CONFLICT",
      message: "Resource version conflict",
      ...(currentVersion === undefined
        ? {}
        : { details: { currentVersion } })
    });
  }
  if (status === 400 || status === 422) {
    return new DomainError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      message: "SEO data request is invalid"
    });
  }
  return dependencyUnavailable();
}

function upstreamErrorCode(payload: unknown): string | undefined {
  const response = objectValue(payload);
  if (typeof response?.code === "string") return response.code;
  const error = objectValue(response?.error);
  return typeof error?.code === "string" ? error.code : undefined;
}

function upstreamCurrentVersion(
  payload: unknown
): number | undefined {
  const response = objectValue(payload);
  const direct = response?.currentVersion;
  if (Number.isSafeInteger(direct) && Number(direct) > 0) {
    return Number(direct);
  }
  const details = objectValue(objectValue(response?.error)?.details);
  const nested = details?.currentVersion;
  return Number.isSafeInteger(nested) && Number(nested) > 0
    ? Number(nested)
    : undefined;
}
