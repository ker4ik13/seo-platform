import { Inject, Injectable } from "@nestjs/common";
import type {
  CompleteUploadInput,
  CreatedMultipartUpload,
  CreateUploadInput,
  CreateUploadPartUrlsInput,
  InternalCreateUploadInput,
  UploadPartUrls,
  UploadSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import type { TenantAuthorization } from "../authorization/authorization.types.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";

interface InternalContext {
  readonly tenant: TenantAuthorization;
  readonly actorId: string;
  readonly requestId: string;
}

@Injectable()
export class JobsUploadClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public create(
    context: InternalContext,
    input: CreateUploadInput,
    idempotencyKey: string
  ): Promise<CreatedMultipartUpload> {
    const body: InternalCreateUploadInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId,
      idempotencyKey
    };
    return this.request("POST", "/internal/v1/uploads", context, body);
  }

  public partUrls(
    context: InternalContext,
    uploadId: string,
    input: CreateUploadPartUrlsInput
  ): Promise<UploadPartUrls> {
    return this.request(
      "POST",
      `/internal/v1/uploads/${encodeURIComponent(uploadId)}/parts`,
      context,
      input
    );
  }

  public complete(
    context: InternalContext,
    uploadId: string,
    input: CompleteUploadInput
  ): Promise<UploadSummary> {
    return this.request(
      "POST",
      `/internal/v1/uploads/${encodeURIComponent(uploadId)}/complete`,
      context,
      input
    );
  }

  public get(
    context: InternalContext,
    uploadId: string
  ): Promise<UploadSummary> {
    return this.request(
      "GET",
      `/internal/v1/uploads/${encodeURIComponent(uploadId)}`,
      context
    );
  }

  public abort(
    context: InternalContext,
    uploadId: string
  ): Promise<UploadSummary> {
    return this.request(
      "DELETE",
      `/internal/v1/uploads/${encodeURIComponent(uploadId)}`,
      context
    );
  }

  private async request<Data>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    context: InternalContext,
    body?: unknown
  ): Promise<Data> {
    const token = this.config.internalApiToken;
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
      response = await fetch(
        new URL(path, this.config.services.jobs),
        {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(this.config.internalCommandTimeoutMs)
        }
      );
    } catch {
      throw dependencyUnavailable();
    }
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw upstreamError(response.status);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload)
    ) {
      throw new DomainError({
        statusCode: 502,
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Upload service returned an invalid response",
        retryable: true
      });
    }
    return payload.data as Data;
  }
}

function requiredProjectId(tenant: TenantAuthorization): string {
  if (!tenant.projectId) {
    throw new Error("Project authorization is required");
  }
  return tenant.projectId;
}

function dependencyUnavailable(): DomainError {
  return new DomainError({
    statusCode: 503,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Upload service is temporarily unavailable",
    retryable: true
  });
}

function upstreamError(status: number): DomainError {
  if (status === 404) {
    return new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Upload not found"
    });
  }
  if (status === 409) {
    return new DomainError({
      statusCode: 409,
      code: "RESOURCE_STATE_CONFLICT",
      message: "Upload state does not allow this operation"
    });
  }
  if (status === 400 || status === 422) {
    return new DomainError({
      statusCode: 422,
      code: "VALIDATION_FAILED",
      message: "Upload request is invalid"
    });
  }
  if (status === 413) {
    return new DomainError({
      statusCode: 413,
      code: "FILE_TOO_LARGE",
      message: "File exceeds the configured upload limit"
    });
  }
  return dependencyUnavailable();
}
