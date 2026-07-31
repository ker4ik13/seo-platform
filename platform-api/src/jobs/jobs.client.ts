import { Inject, Injectable } from "@nestjs/common";
import {
  integrationCapabilities,
  integrationCredentialModes,
  integrationCredentialStatuses,
  integrationCredentialValidationModes,
  integrationCredentialValidationStatuses,
  integrationProviders,
  projectConnectorBindingAvailabilities,
  projectConnectorRouteSourceKinds,
  rankRunConflictDetails,
  rankRunConflictReasons,
  technicalCrawlQueryPolicies
} from "@seo-platform/contracts";
import type {
  AutomationRunCollection,
  AutomationRunSummary,
  CompleteUploadInput,
  ConfigureSemanticImportInput,
  CancelSemanticImportInput,
  CreateSemanticImportInput,
  CreatedMultipartUpload,
  CreateUploadInput,
  CreateUploadPartUrlsInput,
  CreateIntegrationCredentialInput,
  IntegrationCredentialValidationSummary,
  IntegrationCredentialSummary,
  IntegrationProviderCatalogItem,
  CreateProjectConnectorBindingInput,
  InternalCreateIntegrationCredentialInput,
  InternalCreateIntegrationCredentialValidationInput,
  InternalCreateProjectConnectorBindingInput,
  InternalCreateRankEstimateInput,
  InternalCreateRankRunInput,
  CreateTechnicalCrawlInput,
  InternalCreateTechnicalCrawlInput,
  InternalCancelTechnicalCrawlInput,
  InternalRunRankTrackingAutomationInput,
  InternalCancelRankJobInput,
  InternalAutomationStatusInput,
  InternalCreateRankTrackingAutomationInput,
  InternalDeleteIntegrationCredentialInput,
  InternalUpdateProjectConnectorBindingInput,
  InternalUpdateIntegrationCredentialInput,
  InternalUpdateRankTrackingAutomationInput,
  InternalCreateUploadInput,
  InternalCreateSemanticImportInput,
  InternalConfigureSemanticImportInput,
  InternalConfirmSemanticImportInput,
  InternalCancelSemanticImportInput,
  ProjectConnectorBinding,
  ProjectConnectorBindingsAggregate,
  ProjectConnectorBudgetPolicy,
  ProjectConnectorCredentialOption,
  ProjectConnectorFallbackPolicy,
  ProjectConnectorRoute,
  RankTrackingAutomationCollection,
  RankTrackingAutomationSummary,
  RankEstimate,
  RankRunConflictDetails,
  RankRunConflictReason,
  RankJobSummary,
  SemanticImportSummary,
  StorageCapacityEntitlement,
  UploadPartUrls,
  UploadSummary,
  TechnicalCrawlCollection,
  TechnicalCrawlSummary,
  UpdateIntegrationCredentialInput,
  UpdateProjectConnectorBindingInput
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import type { TenantAuthorization } from "../authorization/authorization.types.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import { scopedRankJobSummary } from "./rank-job-response.js";
import { scopedRankEstimate } from "./rank-estimate-response.js";
import {
  scopedAutomation,
  scopedAutomationCollection,
  scopedAutomationRun,
  scopedAutomationRuns
} from "./automation-response.js";

interface InternalContext {
  readonly tenant: TenantAuthorization;
  readonly actorId: string;
  readonly requestId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONNECTOR_VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,31}$/u;
const PROVIDER_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/u;
const CAPABILITIES = new Set<string>(integrationCapabilities);
const CREDENTIAL_MODES = new Set<string>(integrationCredentialModes);
const CREDENTIAL_STATUSES = new Set<string>(
  integrationCredentialStatuses
);
const CREDENTIAL_VALIDATION_MODES = new Set<string>(
  integrationCredentialValidationModes
);
const CREDENTIAL_VALIDATION_STATUSES = new Set<string>(
  integrationCredentialValidationStatuses
);
const PROVIDERS = new Set<string>(integrationProviders);
const PROJECT_BINDING_AVAILABILITIES = new Set<string>(
  projectConnectorBindingAvailabilities
);
const PROJECT_ROUTE_SOURCE_KINDS = new Set<string>(
  projectConnectorRouteSourceKinds
);
const MAX_PROJECT_BINDINGS = integrationCapabilities.length;
const MAX_PROJECT_CREDENTIAL_OPTIONS = 500;
/**
 * Existing Jobs collections are bounded to at most 500 safe summaries.
 * Two MiB leaves ample room for them while preventing a compromised or
 * misconfigured dependency from making Platform API buffer unbounded JSON.
 */
const MAX_JOBS_RESPONSE_BYTES = 2 * 1024 * 1024;

@Injectable()
export class JobsClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public createUpload(
    context: InternalContext,
    input: CreateUploadInput,
    idempotencyKey: string,
    entitlement: StorageCapacityEntitlement
  ): Promise<CreatedMultipartUpload> {
    const body: InternalCreateUploadInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId,
      idempotencyKey,
      entitlement
    };
    return this.request("POST", "/internal/v1/uploads", context, body);
  }

  public async listTechnicalCrawls(
    context: InternalContext
  ): Promise<TechnicalCrawlCollection> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      crawlCollectionPath(context.tenant.workspaceId, projectId),
      context
    );
    const input = exactRecord(value, ["crawls"]);
    if (!Array.isArray(input.crawls) || input.crawls.length > 50) {
      throw invalidJobsResponse();
    }
    return {
      crawls: input.crawls.map((crawl) =>
        technicalCrawlResponse(
          crawl,
          context.tenant.workspaceId,
          projectId
        )
      )
    };
  }

  public async createTechnicalCrawl(
    context: InternalContext,
    input: CreateTechnicalCrawlInput,
    idempotencyKey: string
  ): Promise<TechnicalCrawlSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCreateTechnicalCrawlInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      idempotencyKey,
      correlationId: context.requestId
    };
    const value = await this.request<unknown>(
      "POST",
      crawlCollectionPath(context.tenant.workspaceId, projectId),
      context,
      body,
      "shared",
      idempotencyKey
    );
    return technicalCrawlResponse(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async getTechnicalCrawl(
    context: InternalContext,
    crawlId: string
  ): Promise<TechnicalCrawlSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      `${crawlCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}/${encodeURIComponent(crawlId)}`,
      context
    );
    return technicalCrawlResponse(
      value,
      context.tenant.workspaceId,
      projectId,
      crawlId
    );
  }

  public async cancelTechnicalCrawl(
    context: InternalContext,
    crawlId: string,
    version: number
  ): Promise<TechnicalCrawlSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCancelTechnicalCrawlInput = {
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      version
    };
    const value = await this.request<unknown>(
      "POST",
      `${crawlCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}/${encodeURIComponent(crawlId)}/cancel`,
      context,
      body
    );
    return technicalCrawlResponse(
      value,
      context.tenant.workspaceId,
      projectId,
      crawlId
    );
  }

  public async listAutomations(
    context: InternalContext,
    limit: number
  ): Promise<RankTrackingAutomationCollection> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      `${automationCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}?limit=${encodeURIComponent(String(limit))}`,
      context
    );
    return scopedAutomationCollection(
      value,
      context.tenant.workspaceId,
      projectId,
      limit
    );
  }

  public async createAutomation(
    context: InternalContext,
    input: InternalCreateRankTrackingAutomationInput
  ): Promise<RankTrackingAutomationSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "POST",
      automationCollectionPath(
        context.tenant.workspaceId,
        projectId
      ),
      context,
      input,
      "shared",
      input.idempotencyKey
    );
    return scopedAutomation(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async updateAutomation(
    context: InternalContext,
    input: InternalUpdateRankTrackingAutomationInput
  ): Promise<RankTrackingAutomationSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "PATCH",
      automationPath(
        context.tenant.workspaceId,
        projectId,
        input.automationId
      ),
      context,
      input
    );
    return scopedAutomation(
      value,
      context.tenant.workspaceId,
      projectId,
      input.automationId
    );
  }

  public async setAutomationStatus(
    context: InternalContext,
    input: InternalAutomationStatusInput,
    action: "pause" | "resume"
  ): Promise<RankTrackingAutomationSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "POST",
      `${automationPath(
        context.tenant.workspaceId,
        projectId,
        input.automationId
      )}/${action}`,
      context,
      input
    );
    return scopedAutomation(
      value,
      context.tenant.workspaceId,
      projectId,
      input.automationId
    );
  }

  public async listAutomationRuns(
    context: InternalContext,
    automationId: string
  ): Promise<AutomationRunCollection> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      `${automationPath(
        context.tenant.workspaceId,
        projectId,
        automationId
      )}/runs`,
      context
    );
    return scopedAutomationRuns(
      value,
      context.tenant.workspaceId,
      projectId,
      automationId
    );
  }

  public async runAutomation(
    context: InternalContext,
    input: InternalRunRankTrackingAutomationInput
  ): Promise<AutomationRunSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "POST",
      `${automationPath(
        context.tenant.workspaceId,
        projectId,
        input.automationId
      )}/runs`,
      context,
      input,
      "shared",
      input.idempotencyKey
    );
    return scopedAutomationRun(
      value,
      context.tenant.workspaceId,
      projectId,
      input.automationId
    );
  }

  public createUploadPartUrls(
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

  public completeUpload(
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

  public getUpload(
    context: InternalContext,
    uploadId: string
  ): Promise<UploadSummary> {
    return this.request(
      "GET",
      `/internal/v1/uploads/${encodeURIComponent(uploadId)}`,
      context
    );
  }

  public abortUpload(
    context: InternalContext,
    uploadId: string
  ): Promise<UploadSummary> {
    return this.request(
      "DELETE",
      `/internal/v1/uploads/${encodeURIComponent(uploadId)}`,
      context
    );
  }

  public createSemanticImport(
    context: InternalContext,
    input: CreateSemanticImportInput,
    idempotencyKey: string
  ): Promise<SemanticImportSummary> {
    const body: InternalCreateSemanticImportInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId,
      idempotencyKey
    };
    return this.request("POST", "/internal/v1/imports", context, body);
  }

  public getSemanticImport(
    context: InternalContext,
    importId: string
  ): Promise<SemanticImportSummary> {
    return this.request(
      "GET",
      `/internal/v1/imports/${encodeURIComponent(importId)}`,
      context
    );
  }

  public configureSemanticImport(
    context: InternalContext,
    importId: string,
    input: ConfigureSemanticImportInput
  ): Promise<SemanticImportSummary> {
    const body: InternalConfigureSemanticImportInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId
    };
    return this.request(
      "POST",
      `/internal/v1/imports/${encodeURIComponent(importId)}/mapping`,
      context,
      body
    );
  }

  public confirmSemanticImport(
    context: InternalContext,
    importId: string,
    input: Pick<
      InternalConfirmSemanticImportInput,
      "version" | "entitlement"
    >
  ): Promise<SemanticImportSummary> {
    const body: InternalConfirmSemanticImportInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId
    };
    return this.request(
      "POST",
      `/internal/v1/imports/${encodeURIComponent(importId)}/publish`,
      context,
      body
    );
  }

  public cancelSemanticImport(
    context: InternalContext,
    importId: string,
    input: CancelSemanticImportInput
  ): Promise<SemanticImportSummary> {
    const body: InternalCancelSemanticImportInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId
    };
    return this.request(
      "POST",
      `/internal/v1/imports/${encodeURIComponent(importId)}/cancel`,
      context,
      body
    );
  }

  public async integrationCatalog(
    context: InternalContext
  ): Promise<readonly IntegrationProviderCatalogItem[]> {
    const value = await this.requestIntegration<unknown>(
      "GET",
      integrationPath(context, "catalog"),
      context
    );
    return providerCatalog(value);
  }

  public async listIntegrationCredentials(
    context: InternalContext
  ): Promise<readonly IntegrationCredentialSummary[]> {
    const value = await this.requestIntegration<unknown>(
      "GET",
      integrationPath(context, "credentials"),
      context
    );
    return credentialCollection(value);
  }

  public async createIntegrationCredential(
    context: InternalContext,
    input: CreateIntegrationCredentialInput,
    idempotencyKey: string
  ): Promise<IntegrationCredentialSummary> {
    const body: InternalCreateIntegrationCredentialInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      actorId: context.actorId,
      idempotencyKey
    };
    const value = await this.requestIntegration<unknown>(
      "POST",
      integrationPath(context, "credentials"),
      context,
      body
    );
    return credentialSummary(value);
  }

  public async updateIntegrationCredential(
    context: InternalContext,
    credentialId: string,
    input: UpdateIntegrationCredentialInput,
    version: number
  ): Promise<IntegrationCredentialSummary> {
    const body: InternalUpdateIntegrationCredentialInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      actorId: context.actorId,
      version
    };
    const value = await this.requestIntegration<unknown>(
      "PATCH",
      integrationPath(
        context,
        `credentials/${encodeURIComponent(credentialId)}`
      ),
      context,
      body
    );
    return credentialSummary(value);
  }

  public async createIntegrationCredentialValidation(
    context: InternalContext,
    credentialId: string,
    idempotencyKey: string
  ): Promise<IntegrationCredentialValidationSummary> {
    const body: InternalCreateIntegrationCredentialValidationInput = {
      workspaceId: context.tenant.workspaceId,
      actorId: context.actorId,
      idempotencyKey
    };
    const value = await this.requestIntegration<unknown>(
      "POST",
      integrationPath(
        context,
        `credentials/${encodeURIComponent(credentialId)}/validations`
      ),
      context,
      body
    );
    return scopedCredentialValidationSummary(
      value,
      context.tenant.workspaceId,
      credentialId
    );
  }

  public async getIntegrationCredentialValidation(
    context: InternalContext,
    credentialId: string,
    validationId: string
  ): Promise<IntegrationCredentialValidationSummary> {
    const value = await this.requestIntegration<unknown>(
      "GET",
      integrationPath(
        context,
        `credentials/${encodeURIComponent(
          credentialId
        )}/validations/${encodeURIComponent(validationId)}`
      ),
      context
    );
    return scopedCredentialValidationSummary(
      value,
      context.tenant.workspaceId,
      credentialId,
      validationId
    );
  }

  public async revokeIntegrationCredential(
    context: InternalContext,
    credentialId: string,
    version: number
  ): Promise<void> {
    const body: InternalDeleteIntegrationCredentialInput = {
      workspaceId: context.tenant.workspaceId,
      actorId: context.actorId,
      version
    };
    const value = await this.requestIntegration<unknown>(
      "DELETE",
      integrationPath(
        context,
        `credentials/${encodeURIComponent(credentialId)}`
      ),
      context,
      body
    );
    if (
      typeof value !== "object" ||
      value === null ||
      !("revoked" in value) ||
      value.revoked !== true
    ) {
      throw invalidJobsResponse();
    }
  }

  public async projectConnectorBindings(
    context: InternalContext
  ): Promise<ProjectConnectorBindingsAggregate> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.requestIntegration<unknown>(
      "GET",
      projectIntegrationPath(context, projectId),
      context
    );
    return projectConnectorBindingsAggregate(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async createProjectConnectorBinding(
    context: InternalContext,
    input: CreateProjectConnectorBindingInput,
    idempotencyKey: string
  ): Promise<ProjectConnectorBinding> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCreateProjectConnectorBindingInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      idempotencyKey
    };
    const value = await this.requestIntegration<unknown>(
      "POST",
      projectIntegrationPath(context, projectId),
      context,
      body
    );
    return scopedProjectConnectorBinding(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async updateProjectConnectorBinding(
    context: InternalContext,
    bindingId: string,
    input: UpdateProjectConnectorBindingInput,
    version: number
  ): Promise<ProjectConnectorBinding> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalUpdateProjectConnectorBindingInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      version
    };
    const value = await this.requestIntegration<unknown>(
      "PATCH",
      `${projectIntegrationPath(
        context,
        projectId
      )}/${encodeURIComponent(bindingId)}`,
      context,
      body
    );
    return scopedProjectConnectorBinding(
      value,
      context.tenant.workspaceId,
      projectId,
      bindingId
    );
  }

  public async createRankEstimate(
    context: InternalContext,
    input: InternalCreateRankEstimateInput,
    idempotencyKey: string
  ): Promise<RankEstimate> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.requestIntegration<unknown>(
      "POST",
      `/internal/v1/workspaces/${encodeURIComponent(
        context.tenant.workspaceId
      )}/projects/${encodeURIComponent(projectId)}/rank-estimates`,
      context,
      input,
      idempotencyKey
    );
    return scopedRankEstimate(
      value,
      context.tenant.workspaceId,
      projectId,
      input.trackingContextId
    );
  }

  public async createRankRun(
    context: InternalContext,
    input: InternalCreateRankRunInput,
    idempotencyKey: string
  ): Promise<RankJobSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.requestIntegration<unknown>(
      "POST",
      rankRunCollectionPath(
        context.tenant.workspaceId,
        projectId
      ),
      context,
      input,
      idempotencyKey
    );
    return scopedRankJobSummary(
      value,
      context.tenant.workspaceId,
      projectId,
      undefined,
      input.billingCurrency
    );
  }

  public async getRankJob(
    context: InternalContext,
    jobId: string
  ): Promise<RankJobSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.requestIntegration<unknown>(
      "GET",
      rankJobPath(
        context.tenant.workspaceId,
        projectId,
        jobId
      ),
      context
    );
    return scopedRankJobSummary(
      value,
      context.tenant.workspaceId,
      projectId,
      jobId
    );
  }

  public async cancelRankJob(
    context: InternalContext,
    jobId: string
  ): Promise<RankJobSummary> {
    const projectId = requiredProjectId(context.tenant);
    const input: InternalCancelRankJobInput = {
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      jobId
    };
    const value = await this.requestIntegration<unknown>(
      "POST",
      `${rankJobPath(
        context.tenant.workspaceId,
        projectId,
        jobId
      )}/cancel`,
      context,
      input
    );
    return scopedRankJobSummary(
      value,
      context.tenant.workspaceId,
      projectId,
      jobId
    );
  }

  private requestIntegration<Data>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    context: InternalContext,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<Data> {
    return this.request(
      method,
      path,
      context,
      body,
      "integration-credential",
      idempotencyKey
    );
  }

  private async request<Data>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    context: InternalContext,
    body?: unknown,
    authentication: "shared" | "integration-credential" = "shared",
    idempotencyKey?: string
  ): Promise<Data> {
    const token =
      authentication === "integration-credential"
        ? this.config.integrationCredentialApiToken
        : this.config.jobsApiToken;
    if (!token) throw dependencyUnavailable();
    const headers = new Headers({
      Accept: "application/json",
      "X-Internal-Token": token,
      "X-Request-Id": context.requestId,
      "X-Workspace-Id": context.tenant.workspaceId,
      "X-Actor-Id": context.actorId
    });
    if (context.tenant.projectId) {
      headers.set("X-Project-Id", context.tenant.projectId);
    }
    if (idempotencyKey) {
      headers.set("Idempotency-Key", idempotencyKey);
    }
    if (body !== undefined) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
      response = await fetch(
        new URL(path, this.config.services.jobs),
        {
          method,
          headers,
          redirect: "error",
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(
            method === "GET"
              ? this.config.dependencyTimeoutMs
              : this.config.internalCommandTimeoutMs
          )
        }
      );
    } catch {
      throw dependencyUnavailable();
    }
    const payload = await boundedJobsJson(response);
    if (!response.ok) throw upstreamError(response.status, payload);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload)
    ) {
      throw invalidJobsResponse();
    }
    return payload.data as Data;
  }
}

async function boundedJobsJson(response: Response): Promise<unknown> {
  const advertisedLength = response.headers.get("content-length");
  if (
    advertisedLength !== null &&
    (!/^(?:0|[1-9]\d{0,9})$/u.test(advertisedLength) ||
      Number(advertisedLength) > MAX_JOBS_RESPONSE_BYTES)
  ) {
    await cancelResponseBody(response);
    throw invalidJobsResponse();
  }
  if (!response.body) throw invalidJobsResponse();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value) continue;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_JOBS_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw invalidJobsResponse();
      }
      chunks.push(chunk.value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(json) as unknown;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    await reader.cancel().catch(() => undefined);
    throw invalidJobsResponse();
  } finally {
    reader.releaseLock();
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function integrationPath(
  context: InternalContext,
  suffix: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    context.tenant.workspaceId
  )}/integrations/${suffix}`;
}

function projectIntegrationPath(
  context: InternalContext,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    context.tenant.workspaceId
  )}/projects/${encodeURIComponent(projectId)}/integration-settings`;
}

function rankRunCollectionPath(
  workspaceId: string,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(projectId)}/rank-runs`;
}

function rankJobPath(
  workspaceId: string,
  projectId: string,
  jobId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(
    projectId
  )}/jobs/${encodeURIComponent(jobId)}`;
}

function automationCollectionPath(
  workspaceId: string,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(projectId)}/automations`;
}

function crawlCollectionPath(
  workspaceId: string,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(projectId)}/crawls`;
}

function technicalCrawlResponse(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedId?: string
): TechnicalCrawlSummary {
  const input = crawlRecord(value, [
    "id", "jobId", "workspaceId", "projectId", "status", "config",
    "discoveredUrls", "processedUrls", "successfulUrls", "failedUrls",
    "issueCount", "version", "createdAt"
  ], [
    "failureCode",
    "backoffCode",
    "backoffUntil",
    "startedAt",
    "finishedAt",
    "cancelRequestedAt"
  ]);
  const id = uuidValue(input.id);
  const responseWorkspaceId = uuidValue(input.workspaceId);
  const responseProjectId = uuidValue(input.projectId);
  const configInput = record(input.config);
  const config =
    Object.keys(configInput).length === 5
      ? exactRecord(configInput, [
          "startUrls",
          "maxUrls",
          "maxDepth",
          "requestsPerMinute",
          "obeyRobots"
        ])
      : exactRecord(configInput, [
          "startUrls",
          "sitemapUrls",
          "includePatterns",
          "excludePatterns",
          "queryPolicy",
          "maxUrls",
          "maxDepth",
          "requestsPerMinute",
          "obeyRobots"
        ]);
  const startUrls = Array.isArray(config.startUrls)
    ? config.startUrls.map(safeCrawlResponseUrl)
    : [];
  const sitemapUrls = Array.isArray(config.sitemapUrls)
    ? config.sitemapUrls.map(safeCrawlResponseUrl)
    : [];
  const includePatterns = crawlResponsePatterns(
    config.includePatterns ?? []
  );
  const excludePatterns = crawlResponsePatterns(
    config.excludePatterns ?? []
  );
  const queryPolicy = config.queryPolicy ?? "DROP_TRACKING";
  const failureCode =
    typeof input.failureCode === "string" &&
    [
      "ROBOTS_UNAVAILABLE",
      "SITEMAP_UNAVAILABLE",
      "CRAWL_EXECUTION_FAILED"
    ].includes(
      input.failureCode
    )
      ? input.failureCode
      : undefined;
  const backoffCode =
    typeof input.backoffCode === "string" &&
    [
      "HOST_RATE_LIMIT",
      "HOST_UNAVAILABLE",
      "HOST_NETWORK_ERROR",
      "LATENCY_SPIKE"
    ].includes(input.backoffCode)
      ? input.backoffCode
      : undefined;
  if (
    responseWorkspaceId !== workspaceId ||
    responseProjectId !== projectId ||
    (expectedId && id !== expectedId) ||
    ![
      "QUEUED", "RUNNING", "CANCEL_REQUESTED", "CANCELLED",
      "PARTIALLY_COMPLETED", "COMPLETED", "FAILED"
    ].includes(String(input.status)) ||
    startUrls.length < 1 ||
    startUrls.length > 20 ||
    sitemapUrls.length > 10 ||
    new Set(startUrls).size !== startUrls.length ||
    new Set(sitemapUrls).size !== sitemapUrls.length ||
    new Set([...startUrls, ...sitemapUrls].map(
      (url) => new URL(url).origin
    )).size !== 1 ||
    !technicalCrawlQueryPolicies.includes(
      queryPolicy as (typeof technicalCrawlQueryPolicies)[number]
    ) ||
    config.obeyRobots !== true
  ) {
    throw invalidJobsResponse();
  }
  const summary: TechnicalCrawlSummary = {
    id,
    jobId: uuidValue(input.jobId),
    workspaceId: responseWorkspaceId,
    projectId: responseProjectId,
    status: input.status as TechnicalCrawlSummary["status"],
    config: {
      startUrls,
      sitemapUrls,
      includePatterns,
      excludePatterns,
      queryPolicy:
        queryPolicy as TechnicalCrawlSummary["config"]["queryPolicy"],
      maxUrls: boundedPositiveInteger(config.maxUrls, 1_000),
      maxDepth: boundedNonNegativeInteger(config.maxDepth, 10),
      requestsPerMinute: boundedPositiveInteger(
        config.requestsPerMinute,
        60
      ),
      obeyRobots: true
    },
    discoveredUrls: boundedNonNegativeInteger(input.discoveredUrls, 1_000),
    processedUrls: boundedNonNegativeInteger(input.processedUrls, 1_000),
    successfulUrls: boundedNonNegativeInteger(input.successfulUrls, 1_000),
    failedUrls: boundedNonNegativeInteger(input.failedUrls, 1_000),
    issueCount: boundedNonNegativeInteger(input.issueCount, 100_000),
    version: positiveInteger(input.version),
    createdAt: isoDateValue(input.createdAt),
    ...(failureCode ? { failureCode } : {}),
    ...(backoffCode
      ? {
          backoffCode:
            backoffCode as Exclude<
              TechnicalCrawlSummary["backoffCode"],
              undefined
            >,
          backoffUntil: isoDateValue(input.backoffUntil)
        }
      : {}),
    ...(input.startedAt !== undefined
      ? { startedAt: isoDateValue(input.startedAt) }
      : {}),
    ...(input.finishedAt !== undefined
      ? { finishedAt: isoDateValue(input.finishedAt) }
      : {}),
    ...(input.cancelRequestedAt !== undefined
      ? { cancelRequestedAt: isoDateValue(input.cancelRequestedAt) }
      : {})
  };
  if (
    summary.processedUrls !==
      summary.successfulUrls + summary.failedUrls ||
    summary.processedUrls > summary.discoveredUrls ||
    !validCrawlLifecycle(
      summary,
      input.failureCode,
      input.backoffCode,
      input.backoffUntil
    )
  ) {
    throw invalidJobsResponse();
  }
  return summary;
}

function crawlResponsePatterns(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        !item.startsWith("/") ||
        item.length > 200 ||
        [...item].some((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 0x20 || code === 0x7f || character === "#";
        })
    ) ||
    new Set(value).size !== value.length
  ) {
    throw invalidJobsResponse();
  }
  return value as readonly string[];
}

function validCrawlLifecycle(
  crawl: TechnicalCrawlSummary,
  rawFailureCode: unknown,
  rawBackoffCode: unknown,
  rawBackoffUntil: unknown
): boolean {
  const created = Date.parse(crawl.createdAt);
  const started = crawl.startedAt ? Date.parse(crawl.startedAt) : undefined;
  const finished = crawl.finishedAt ? Date.parse(crawl.finishedAt) : undefined;
  const cancelled = crawl.cancelRequestedAt
    ? Date.parse(crawl.cancelRequestedAt)
    : undefined;
  if (
    (started !== undefined && started < created) ||
    (finished !== undefined && finished < (started ?? created)) ||
    (cancelled !== undefined && cancelled < created)
  ) return false;
  const hasBackoff =
    crawl.backoffCode !== undefined &&
    crawl.backoffUntil !== undefined &&
    rawBackoffCode === crawl.backoffCode &&
    rawBackoffUntil === crawl.backoffUntil;
  if (
    (rawBackoffCode === undefined) !==
      (rawBackoffUntil === undefined) ||
    (
      rawBackoffCode !== undefined &&
      !hasBackoff
    )
  ) {
    return false;
  }
  if (crawl.status === "QUEUED") {
    return finished === undefined && cancelled === undefined &&
      rawFailureCode === undefined;
  }
  if (hasBackoff) return false;
  if (crawl.status === "RUNNING") {
    return started !== undefined && finished === undefined &&
      cancelled === undefined && rawFailureCode === undefined;
  }
  if (crawl.status === "CANCEL_REQUESTED") {
    return started !== undefined && finished === undefined &&
      cancelled !== undefined && rawFailureCode === undefined;
  }
  if (crawl.status === "CANCELLED") {
    return finished !== undefined && cancelled !== undefined &&
      rawFailureCode === undefined;
  }
  if (crawl.status === "COMPLETED") {
    return started !== undefined && finished !== undefined &&
      crawl.failedUrls === 0 && rawFailureCode === undefined;
  }
  if (crawl.status === "PARTIALLY_COMPLETED") {
    return started !== undefined && finished !== undefined &&
      crawl.failedUrls > 0 && rawFailureCode === undefined;
  }
  return crawl.status === "FAILED" && finished !== undefined &&
    crawl.failureCode !== undefined && rawFailureCode === crawl.failureCode;
}

function safeCrawlResponseUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4_096) {
    throw invalidJobsResponse();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidJobsResponse();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw invalidJobsResponse();
  }
  return url.toString();
}

function crawlRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = record(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((field) => !(field in input)) ||
    Object.keys(input).some((field) => !allowed.has(field))
  ) {
    throw invalidJobsResponse();
  }
  return input;
}

function boundedPositiveInteger(value: unknown, max: number): number {
  const parsed = positiveInteger(value);
  if (parsed > max) throw invalidJobsResponse();
  return parsed;
}

function boundedNonNegativeInteger(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) {
    throw invalidJobsResponse();
  }
  return Number(value);
}

function automationPath(
  workspaceId: string,
  projectId: string,
  automationId: string
): string {
  return `${automationCollectionPath(
    workspaceId,
    projectId
  )}/${encodeURIComponent(automationId)}`;
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
    message: "Jobs service is temporarily unavailable",
    retryable: true
  });
}

function invalidJobsResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs service returned an invalid response",
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
        message: "A project integration already exists"
      });
    }
    if (code === "QUOTA_EXCEEDED") {
      return new DomainError({
        statusCode: 409,
        code: "QUOTA_EXCEEDED",
        message: "The current plan capacity would be exceeded"
      });
    }
    if (isRankRunConflictReason(code)) {
      const details = upstreamRankRunConflictDetails(payload, code);
      if (!details) return dependencyUnavailable();
      return new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "Manual rank Job cannot be created in the current state",
        details
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
      message: "Jobs request is invalid"
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

const RANK_RUN_CONFLICT_REASONS: ReadonlySet<string> = new Set(
  rankRunConflictReasons
);

function isRankRunConflictReason(
  value: string | undefined
): value is RankRunConflictReason {
  return value !== undefined && RANK_RUN_CONFLICT_REASONS.has(value);
}

function upstreamRankRunConflictDetails(
  payload: unknown,
  expectedReason: RankRunConflictReason
): RankRunConflictDetails | undefined {
  const details = unknownRecord(unknownRecord(payload)?.error)?.details;
  try {
    const parsed = rankRunConflictDetails(details);
    return parsed.reason === expectedReason ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function upstreamErrorCode(payload: unknown): string | undefined {
  const input = unknownRecord(payload);
  if (typeof input?.code === "string") return input.code;
  const error = unknownRecord(input?.error);
  return typeof error?.code === "string" ? error.code : undefined;
}

function upstreamCurrentVersion(payload: unknown): number | undefined {
  const input = unknownRecord(payload);
  const direct = input?.currentVersion;
  if (Number.isSafeInteger(direct) && Number(direct) > 0) {
    return Number(direct);
  }
  const details = unknownRecord(unknownRecord(input?.error)?.details);
  const nested = details?.currentVersion;
  return Number.isSafeInteger(nested) && Number(nested) > 0
    ? Number(nested)
    : undefined;
}

function projectConnectorBindingsAggregate(
  value: unknown,
  workspaceId: string,
  projectId: string
): ProjectConnectorBindingsAggregate {
  const input = exactRecord(value, [
    "bindings",
    "credentialOptions",
    "credentialOptionsTruncated"
  ]);
  if (
    !Array.isArray(input.bindings) ||
    input.bindings.length > MAX_PROJECT_BINDINGS ||
    !Array.isArray(input.credentialOptions) ||
    input.credentialOptions.length > MAX_PROJECT_CREDENTIAL_OPTIONS ||
    typeof input.credentialOptionsTruncated !== "boolean"
  ) {
    throw invalidJobsResponse();
  }

  const bindings = input.bindings.map((binding) =>
    scopedProjectConnectorBinding(binding, workspaceId, projectId)
  );
  const credentialOptions = input.credentialOptions.map((credential) =>
    projectConnectorCredentialOption(credential, workspaceId)
  );
  assertUnique(
    bindings.map(({ id }) => id),
    bindings.map(({ capability }) => capability),
    credentialOptions.map(({ id }) => id)
  );

  const credentialsById = new Map(
    credentialOptions.map((credential) => [credential.id, credential])
  );
  for (const binding of bindings) {
    const credential = credentialsById.get(binding.route.credentialId);
    if (
      credential &&
      (credential.provider !== binding.route.provider ||
        credential.mode !== binding.route.credentialMode)
    ) {
      throw invalidJobsResponse();
    }
    if (
      binding.availability !==
      expectedProjectBindingAvailability(binding, credential)
    ) {
      throw invalidJobsResponse();
    }
  }
  return {
    bindings,
    credentialOptions,
    credentialOptionsTruncated: input.credentialOptionsTruncated
  };
}

function expectedProjectBindingAvailability(
  binding: ProjectConnectorBinding,
  credential: ProjectConnectorCredentialOption | undefined
): ProjectConnectorBinding["availability"] {
  if (!binding.enabled) return "DISABLED";
  if (!credential) return "CREDENTIAL_UNAVAILABLE";
  if (credential.status === "PENDING_VERIFICATION") {
    return "CREDENTIAL_PENDING";
  }
  if (
    credential.status !== "ACTIVE" ||
    credential.mode !== "BYOK_API_KEY"
  ) {
    return "CREDENTIAL_UNAVAILABLE";
  }
  return credential.capabilities.includes(binding.capability)
    ? "READY"
    : "CAPABILITY_MISMATCH";
}

function scopedProjectConnectorBinding(
  value: unknown,
  workspaceId: string,
  projectId: string,
  bindingId?: string
): ProjectConnectorBinding {
  const input = exactRecord(value, [
    "id",
    "workspaceId",
    "projectId",
    "capability",
    "enabled",
    "route",
    "fallbackPolicy",
    "budgetPolicy",
    "availability",
    "version",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt"
  ]);
  const id = uuidValue(input.id);
  const responseWorkspaceId = uuidValue(input.workspaceId);
  const responseProjectId = uuidValue(input.projectId);
  const capability = capabilityValue(input.capability);
  const availability = projectBindingAvailabilityValue(
    input.availability
  );
  const route = projectConnectorRoute(
    input.route,
    responseWorkspaceId,
    responseProjectId,
    id
  );
  const version = positiveInteger(input.version);
  const createdBy = uuidValue(input.createdBy);
  const updatedBy = uuidValue(input.updatedBy);
  const createdAt = isoDateValue(input.createdAt);
  const updatedAt = isoDateValue(input.updatedAt);
  if (
    responseWorkspaceId !== workspaceId ||
    responseProjectId !== projectId ||
    (bindingId !== undefined && id !== bindingId) ||
    typeof input.enabled !== "boolean"
  ) {
    throw invalidJobsResponse();
  }
  return {
    id,
    workspaceId: responseWorkspaceId,
    projectId: responseProjectId,
    capability,
    enabled: input.enabled,
    route,
    fallbackPolicy: projectFallbackPolicy(input.fallbackPolicy),
    budgetPolicy: projectBudgetPolicy(input.budgetPolicy),
    availability,
    version,
    createdBy,
    updatedBy,
    createdAt,
    updatedAt
  };
}

function projectConnectorRoute(
  value: unknown,
  workspaceId: string,
  projectId: string,
  bindingId: string
): ProjectConnectorRoute {
  const input = exactRecord(value, [
    "id",
    "bindingId",
    "workspaceId",
    "projectId",
    "position",
    "sourceKind",
    "credentialId",
    "provider",
    "credentialMode",
    "createdAt",
    "updatedAt"
  ]);
  const routeWorkspaceId = uuidValue(input.workspaceId);
  const routeProjectId = uuidValue(input.projectId);
  const routeBindingId = uuidValue(input.bindingId);
  const sourceKind = projectRouteSourceKindValue(input.sourceKind);
  const credentialMode = credentialModeValue(input.credentialMode);
  if (
    routeWorkspaceId !== workspaceId ||
    routeProjectId !== projectId ||
    routeBindingId !== bindingId ||
    input.position !== 0
  ) {
    throw invalidJobsResponse();
  }
  return {
    id: uuidValue(input.id),
    bindingId: routeBindingId,
    workspaceId: routeWorkspaceId,
    projectId: routeProjectId,
    position: 0,
    sourceKind,
    credentialId: uuidValue(input.credentialId),
    provider: providerValue(input.provider),
    credentialMode,
    createdAt: isoDateValue(input.createdAt),
    updatedAt: isoDateValue(input.updatedAt)
  };
}

function projectConnectorCredentialOption(
  value: unknown,
  workspaceId: string
): ProjectConnectorCredentialOption {
  const input = exactRecord(value, [
    "id",
    "workspaceId",
    "provider",
    "label",
    "mode",
    "status",
    "capabilities"
  ]);
  const responseWorkspaceId = uuidValue(input.workspaceId);
  const capabilities = stringArray(input.capabilities);
  if (
    responseWorkspaceId !== workspaceId ||
    typeof input.label !== "string" ||
    input.label.length === 0 ||
    input.label.length > 160 ||
    input.label !== input.label.trim() ||
    capabilities.length > integrationCapabilities.length ||
    new Set(capabilities).size !== capabilities.length ||
    capabilities.some((capability) => !CAPABILITIES.has(capability))
  ) {
    throw invalidJobsResponse();
  }
  return {
    id: uuidValue(input.id),
    workspaceId: responseWorkspaceId,
    provider: providerValue(input.provider),
    label: input.label,
    mode: credentialModeValue(input.mode),
    status: credentialStatusValue(input.status),
    capabilities:
      capabilities as ProjectConnectorCredentialOption["capabilities"]
  };
}

function projectFallbackPolicy(
  value: unknown
): ProjectConnectorFallbackPolicy {
  const input = exactRecord(value, ["mode"]);
  if (input.mode !== "NONE") throw invalidJobsResponse();
  return { mode: "NONE" };
}

function projectBudgetPolicy(value: unknown): ProjectConnectorBudgetPolicy {
  const input = exactRecord(value, ["mode"]);
  if (input.mode !== "DISABLED") throw invalidJobsResponse();
  return { mode: "DISABLED" };
}

function capabilityValue(
  value: unknown
): ProjectConnectorBinding["capability"] {
  if (typeof value !== "string" || !CAPABILITIES.has(value)) {
    throw invalidJobsResponse();
  }
  return value as ProjectConnectorBinding["capability"];
}

function projectBindingAvailabilityValue(
  value: unknown
): ProjectConnectorBinding["availability"] {
  if (
    typeof value !== "string" ||
    !PROJECT_BINDING_AVAILABILITIES.has(value)
  ) {
    throw invalidJobsResponse();
  }
  return value as ProjectConnectorBinding["availability"];
}

function projectRouteSourceKindValue(
  value: unknown
): ProjectConnectorRoute["sourceKind"] {
  if (
    typeof value !== "string" ||
    !PROJECT_ROUTE_SOURCE_KINDS.has(value)
  ) {
    throw invalidJobsResponse();
  }
  return value as ProjectConnectorRoute["sourceKind"];
}

function credentialModeValue(
  value: unknown
): ProjectConnectorCredentialOption["mode"] {
  if (typeof value !== "string" || !CREDENTIAL_MODES.has(value)) {
    throw invalidJobsResponse();
  }
  return value as ProjectConnectorCredentialOption["mode"];
}

function credentialStatusValue(
  value: unknown
): ProjectConnectorCredentialOption["status"] {
  if (typeof value !== "string" || !CREDENTIAL_STATUSES.has(value)) {
    throw invalidJobsResponse();
  }
  return value as ProjectConnectorCredentialOption["status"];
}

function uuidValue(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidJobsResponse();
  }
  return value.toLowerCase();
}

function isoDateValue(value: unknown): string {
  if (typeof value !== "string" || !isIsoDate(value)) {
    throw invalidJobsResponse();
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw invalidJobsResponse();
  }
  return Number(value);
}

function assertUnique(...collections: readonly (readonly string[])[]): void {
  if (
    collections.some(
      (collection) => new Set(collection).size !== collection.length
    )
  ) {
    throw invalidJobsResponse();
  }
}

function providerCatalog(
  value: unknown
): readonly IntegrationProviderCatalogItem[] {
  if (!Array.isArray(value)) throw invalidJobsResponse();
  return value.map((item) => {
    const input = record(item);
    const provider = providerValue(input.provider);
    const credentialValidationMode = credentialValidationModeValue(
      input.credentialValidationMode
    );
    const capabilities = stringArray(input.capabilities);
    const supportedModes = stringArray(input.supportedModes);
    if (
      typeof input.displayName !== "string" ||
      typeof input.description !== "string" ||
      typeof input.requiresAccountIdentifier !== "boolean" ||
      typeof input.subscriptionNotice !== "string" ||
      (input.accountIdentifierLabel !== undefined &&
        typeof input.accountIdentifierLabel !== "string") ||
      capabilities.some((capability) => !CAPABILITIES.has(capability)) ||
      supportedModes.length === 0 ||
      supportedModes.some((mode) => !CREDENTIAL_MODES.has(mode))
    ) {
      throw invalidJobsResponse();
    }
    return {
      provider,
      displayName: input.displayName,
      description: input.description,
      capabilities:
        capabilities as IntegrationProviderCatalogItem["capabilities"],
      supportedModes:
        supportedModes as IntegrationProviderCatalogItem["supportedModes"],
      credentialValidationMode,
      requiresAccountIdentifier: input.requiresAccountIdentifier,
      ...(typeof input.accountIdentifierLabel === "string"
        ? { accountIdentifierLabel: input.accountIdentifierLabel }
        : {}),
      subscriptionNotice: input.subscriptionNotice
    };
  });
}

function credentialCollection(
  value: unknown
): readonly IntegrationCredentialSummary[] {
  if (!Array.isArray(value)) throw invalidJobsResponse();
  return value.map(credentialSummary);
}

function credentialSummary(value: unknown): IntegrationCredentialSummary {
  const input = record(value);
  const provider = providerValue(input.provider);
  const capabilities = stringArray(input.capabilities);
  if (
    typeof input.id !== "string" ||
    !UUID_PATTERN.test(input.id) ||
    typeof input.workspaceId !== "string" ||
    !UUID_PATTERN.test(input.workspaceId) ||
    typeof input.label !== "string" ||
    typeof input.mode !== "string" ||
    !CREDENTIAL_MODES.has(input.mode) ||
    typeof input.status !== "string" ||
    !CREDENTIAL_STATUSES.has(input.status) ||
    typeof input.displayHint !== "string" ||
    capabilities.some((capability) => !CAPABILITIES.has(capability)) ||
    !Number.isSafeInteger(input.version) ||
    typeof input.createdAt !== "string" ||
    !isIsoDate(input.createdAt) ||
    typeof input.updatedAt !== "string" ||
    !isIsoDate(input.updatedAt) ||
    (input.verifiedAt !== undefined &&
      (typeof input.verifiedAt !== "string" ||
        !isIsoDate(input.verifiedAt))) ||
    (input.lastSuccessAt !== undefined &&
      (typeof input.lastSuccessAt !== "string" ||
        !isIsoDate(input.lastSuccessAt))) ||
    (input.lastErrorAt !== undefined &&
      (typeof input.lastErrorAt !== "string" ||
        !isIsoDate(input.lastErrorAt))) ||
    (input.lastErrorCode !== undefined &&
      (typeof input.lastErrorCode !== "string" ||
        !PROVIDER_ERROR_CODE_PATTERN.test(input.lastErrorCode)))
  ) {
    throw invalidJobsResponse();
  }
  const activeValidation =
    input.activeValidation === undefined
      ? undefined
      : credentialValidationSummary(input.activeValidation);
  if (
    activeValidation &&
    (activeValidation.workspaceId !== input.workspaceId ||
      activeValidation.credentialId !== input.id ||
      activeValidation.provider !== provider ||
      ![
        "QUEUED",
        "RUNNING",
        "RETRY_SCHEDULED"
      ].includes(activeValidation.status))
  ) {
    throw invalidJobsResponse();
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    provider,
    label: input.label,
    mode: input.mode as IntegrationCredentialSummary["mode"],
    status:
      input.status as IntegrationCredentialSummary["status"],
    displayHint: input.displayHint,
    capabilities:
      capabilities as IntegrationCredentialSummary["capabilities"],
    ...(typeof input.verifiedAt === "string"
      ? { verifiedAt: input.verifiedAt }
      : {}),
    ...(typeof input.lastSuccessAt === "string"
      ? { lastSuccessAt: input.lastSuccessAt }
      : {}),
    ...(typeof input.lastErrorAt === "string"
      ? { lastErrorAt: input.lastErrorAt }
      : {}),
    ...(typeof input.lastErrorCode === "string"
      ? { lastErrorCode: input.lastErrorCode }
      : {}),
    ...(activeValidation ? { activeValidation } : {}),
    version: Number(input.version),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function credentialValidationSummary(
  value: unknown
): IntegrationCredentialValidationSummary {
  const input = record(value);
  const provider = providerValue(input.provider);
  if (
    typeof input.id !== "string" ||
    !UUID_PATTERN.test(input.id) ||
    typeof input.workspaceId !== "string" ||
    !UUID_PATTERN.test(input.workspaceId) ||
    typeof input.credentialId !== "string" ||
    !UUID_PATTERN.test(input.credentialId) ||
    !Number.isSafeInteger(input.credentialMaterialVersion) ||
    Number(input.credentialMaterialVersion) < 1 ||
    typeof input.status !== "string" ||
    !CREDENTIAL_VALIDATION_STATUSES.has(input.status) ||
    (input.errorCode !== undefined &&
      (typeof input.errorCode !== "string" ||
        !PROVIDER_ERROR_CODE_PATTERN.test(input.errorCode))) ||
    typeof input.connectorVersion !== "string" ||
    !CONNECTOR_VERSION_PATTERN.test(input.connectorVersion) ||
    typeof input.requestedAt !== "string" ||
    !isIsoDate(input.requestedAt) ||
    (input.startedAt !== undefined &&
      (typeof input.startedAt !== "string" ||
        !isIsoDate(input.startedAt))) ||
    (input.retryAt !== undefined &&
      (typeof input.retryAt !== "string" ||
        !isIsoDate(input.retryAt))) ||
    (input.finishedAt !== undefined &&
      (typeof input.finishedAt !== "string" ||
        !isIsoDate(input.finishedAt)))
  ) {
    throw invalidJobsResponse();
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    credentialId: input.credentialId,
    credentialMaterialVersion: Number(
      input.credentialMaterialVersion
    ),
    provider,
    status:
      input.status as IntegrationCredentialValidationSummary["status"],
    ...(typeof input.errorCode === "string"
      ? { errorCode: input.errorCode }
      : {}),
    connectorVersion: input.connectorVersion,
    requestedAt: input.requestedAt,
    ...(typeof input.startedAt === "string"
      ? { startedAt: input.startedAt }
      : {}),
    ...(typeof input.retryAt === "string"
      ? { retryAt: input.retryAt }
      : {}),
    ...(typeof input.finishedAt === "string"
      ? { finishedAt: input.finishedAt }
      : {})
  };
}

function scopedCredentialValidationSummary(
  value: unknown,
  workspaceId: string,
  credentialId: string,
  validationId?: string
): IntegrationCredentialValidationSummary {
  const result = credentialValidationSummary(value);
  if (
    result.workspaceId !== workspaceId ||
    result.credentialId !== credentialId ||
    (validationId !== undefined && result.id !== validationId)
  ) {
    throw invalidJobsResponse();
  }
  return result;
}

function providerValue(
  value: unknown
): IntegrationCredentialSummary["provider"] {
  if (typeof value !== "string" || !PROVIDERS.has(value)) {
    throw invalidJobsResponse();
  }
  return value as IntegrationCredentialSummary["provider"];
}

function credentialValidationModeValue(
  value: unknown
): IntegrationProviderCatalogItem["credentialValidationMode"] {
  if (
    typeof value !== "string" ||
    !CREDENTIAL_VALIDATION_MODES.has(value)
  ) {
    throw invalidJobsResponse();
  }
  return value as IntegrationProviderCatalogItem["credentialValidationMode"];
}

function isIsoDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalidJobsResponse();
  }
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidJobsResponse();
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = record(value);
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field))
  ) {
    throw invalidJobsResponse();
  }
  return input;
}

function unknownRecord(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
