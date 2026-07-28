import { Inject, Injectable } from "@nestjs/common";
import {
  semanticKeywordSourceModes,
  type ApiCollectionResponse,
  type KeywordListQuery,
  type SemanticKeywordListItem
} from "@seo-platform/contracts";
import type { TenantAuthorization } from "../authorization/authorization.types.js";
import { DomainError } from "../common/domain-error.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

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

    const payload = await this.request(url, context);
    return semanticKeywordPage(payload);
  }

  private async request(
    url: URL,
    context: InternalContext
  ): Promise<unknown> {
    const token = this.config.internalApiToken;
    if (!token) throw dependencyUnavailable();

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Internal-Token": token,
          "X-Request-Id": context.requestId,
          "X-Workspace-Id": context.tenant.workspaceId,
          "X-Project-Id": requiredProjectId(context.tenant),
          "X-Actor-Id": context.actorId
        },
        signal: AbortSignal.timeout(this.config.dependencyTimeoutMs)
      });
    } catch {
      throw dependencyUnavailable();
    }

    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw upstreamError(response.status);
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

function upstreamError(status: number): DomainError {
  if (status === 404) {
    return new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Resource not found"
    });
  }
  if (status === 400 || status === 422) {
    return new DomainError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      message: "Semantic keyword query is invalid"
    });
  }
  return dependencyUnavailable();
}
