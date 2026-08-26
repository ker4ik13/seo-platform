import { Inject, Injectable } from "@nestjs/common";
import {
  connectorFallbackModes,
  connectorFallbackReasons,
  connectorRoutingScopes,
  type ConnectorFallbackReason,
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
  technicalCrawlHomepageChecks,
  technicalCrawlHomepageProbeUrls,
  technicalCrawlMaxRequestsPerMinute,
  technicalCrawlMaxUrlLimit,
  technicalCrawlPurposes,
  technicalCrawlQueryPolicies,
  technicalCrawlStartUrlLimit,
  adminOperationStatuses
} from "@seo-platform/contracts";
import type {
  AutomationRunCollection,
  AutomationRunSummary,
  CrawlAutomationCollection,
  CrawlAutomationRunCollection,
  CrawlAutomationRunSummary,
  CrawlAutomationSummary,
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
  InternalCreateCrawlAutomationInput,
  InternalUpdateCrawlAutomationInput,
  InternalCrawlAutomationStatusInput,
  InternalRunCrawlAutomationInput,
  InternalCancelTechnicalCrawlInput,
  InternalRunRankTrackingAutomationInput,
  InternalCancelRankJobInput,
  InternalRetryRankJobInput,
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
  RankRuntimeDiagnostics,
  SemanticImportSummary,
  StorageCapacityEntitlement,
  UploadPartUrls,
  UploadSummary,
  TechnicalCrawlCollection,
  TechnicalCrawlSummary,
  UpdateIntegrationCredentialInput,
  UpdateProjectConnectorBindingInput,
  CreateKeywordResearchRunInput,
  InternalCreateKeywordResearchRunInput,
  InternalConfirmKeywordResearchRunInput,
  InternalCancelKeywordResearchRunInput,
  InternalRetryKeywordResearchImportInput,
  ConfirmKeywordResearchRunInput,
  KeywordResearchRowPage,
  KeywordResearchRunSummary,
  SemanticCapacityEntitlement,
  CreateFrequencyCollectionInput,
  InternalCreateFrequencyCollectionInput,
  InternalCancelFrequencyCollectionInput,
  InternalRetryFrequencyCollectionInput,
  FrequencyCollectionSummary,
  InternalFrequencyOperationScope,
  InternalProjectWorkspaceTransferInput,
  InternalProjectExecutionResetResult,
  IntegrationCapability,
  InternalUpsertWorkspaceConnectorBindingInput,
  UpsertWorkspaceConnectorBindingInput,
  WorkspaceConnectorBinding,
  WorkspaceConnectorRoute,
  WorkspaceConnectorRoutingSettings,
  AdminOperationStatus,
  AdminOperationStatusGroup,
  AdminOperationResultMetrics,
  InternalAdminOperationSearchResult,
  InternalAdminOperationSummary,
  CreateSemanticExportInput,
  InternalCreateSemanticExportInput,
  InternalCancelSemanticExportInput,
  SemanticExportCollection,
  SemanticExportDownload,
  SemanticExportJobSummary,
  CreateAiAnswerCollectionInput,
  InternalCreateAiAnswerCollectionInput,
  InternalCancelAiAnswerCollectionInput,
  AiAnswerCollectionSummary,
  InternalAiAnswerOperationScope,
  CreateClusteringRunInput,
  InternalCreateClusteringRunInput,
  InternalCancelClusteringRunInput,
  ClusteringRunSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import type { TenantAuthorization } from "../authorization/authorization.types.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import {
  scopedRankJobSummary,
  scopedRankRuntimeDiagnostics
} from "./rank-job-response.js";
import { scopedRankEstimate } from "./rank-estimate-response.js";
import {
  scopedAutomation,
  scopedAutomationCollection,
  scopedAutomationRun,
  scopedAutomationRuns
} from "./automation-response.js";
import {
  scopedCrawlAutomation,
  scopedCrawlAutomationCollection,
  scopedCrawlAutomationRun,
  scopedCrawlAutomationRuns
} from "./crawl-automation-response.js";
import {
  scopedKeywordResearchRowPage,
  scopedKeywordResearchRun
} from "./keyword-research-response.js";
import {
  scopedFrequencyCollection,
  scopedFrequencyOperationScope
} from "./frequency-collection-response.js";
import {
  scopedSemanticExportCollection,
  scopedSemanticExportSummary,
  semanticExportDownload
} from "./semantic-export-response.js";
import {
  scopedAiAnswerCollection,
  scopedAiAnswerOperationScope
} from "./ai-answer-collection-response.js";
import { scopedClusteringRun } from "./clustering-run-response.js";

interface InternalContext {
  readonly tenant: TenantAuthorization;
  readonly actorId: string;
  readonly requestId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONNECTOR_VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,31}$/u;
const PROVIDER_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/u;
const NON_NEGATIVE_MONEY_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/u;
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
const CONNECTOR_FALLBACK_MODES = new Set<string>(connectorFallbackModes);
const CONNECTOR_FALLBACK_REASONS = new Set<string>(connectorFallbackReasons);
const CONNECTOR_ROUTING_SCOPES = new Set<string>(connectorRoutingScopes);
const MAX_PROJECT_BINDINGS = integrationCapabilities.length;
const MAX_PROJECT_CREDENTIAL_OPTIONS = 500;
/**
 * Existing Jobs collections are bounded to at most 500 safe summaries.
 * Two MiB leaves ample room for them while preventing a compromised or
 * misconfigured dependency from making Platform API buffer unbounded JSON.
 */
const MAX_JOBS_RESPONSE_BYTES = 2 * 1024 * 1024;
const CLUSTERING_RUN_CREATE_TIMEOUT_MS = 120_000;
const ADMIN_OPERATION_STATUSES = new Set<string>(adminOperationStatuses);

@Injectable()
export class JobsClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async resetProjectForWorkspaceTransfer(
    input: InternalProjectWorkspaceTransferInput,
    requestId: string
  ): Promise<void> {
    const context: InternalContext = {
      actorId: input.actorId,
      requestId,
      tenant: {
        workspaceId: input.workspaceId,
        workspaceStatus: "ACTIVE",
        projectId: input.projectId,
        projectStatus: "ARCHIVED",
        roleCode: "OWNER"
      }
    };
    const result = await this.requestIntegration<InternalProjectExecutionResetResult>(
      "POST",
      projectTransferResetPath(input.workspaceId, input.projectId),
      context,
      input
    );
    if (result.status !== "RESET") throw invalidJobsResponse();
  }

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

  public async listKeywordResearchRuns(
    context: InternalContext
  ): Promise<readonly KeywordResearchRunSummary[]> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      keywordResearchCollectionPath(context.tenant.workspaceId, projectId),
      context,
      undefined,
      "integration-credential"
    );
    const input = exactRecord(value, ["runs"]);
    if (!Array.isArray(input.runs) || input.runs.length > 25) {
      throw invalidJobsResponse();
    }
    return input.runs.map((run) =>
      scopedKeywordResearchRun(
        run,
        context.tenant.workspaceId,
        projectId
      )
    );
  }

  public async listFrequencyCollections(
    context: InternalContext
  ): Promise<readonly FrequencyCollectionSummary[]> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      frequencyCollectionPath(context.tenant.workspaceId, projectId),
      context
    );
    const input = exactRecord(value, ["collections"]);
    if (!Array.isArray(input.collections) || input.collections.length > 25) {
      throw invalidJobsResponse();
    }
    return input.collections.map((collection) =>
      scopedFrequencyCollection(
        collection,
        context.tenant.workspaceId,
        projectId
      )
    );
  }

  public async listAiAnswerCollections(
    context: InternalContext
  ): Promise<readonly AiAnswerCollectionSummary[]> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      aiAnswerCollectionPath(context.tenant.workspaceId, projectId),
      context
    );
    const input = exactRecord(value, ["collections"]);
    if (!Array.isArray(input.collections) || input.collections.length > 25) {
      throw invalidJobsResponse();
    }
    return input.collections.map((collection) => scopedAiAnswerCollection(
      collection,
      context.tenant.workspaceId,
      projectId
    ));
  }

  public async listClusteringRuns(
    context: InternalContext
  ): Promise<readonly ClusteringRunSummary[]> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      clusteringRunPath(context.tenant.workspaceId, projectId),
      context
    );
    const input = exactRecord(value, ["runs"]);
    if (!Array.isArray(input.runs) || input.runs.length > 25) {
      throw invalidJobsResponse();
    }
    return input.runs.map((run) => scopedClusteringRun(
      run,
      context.tenant.workspaceId,
      projectId
    ));
  }

  public async listProjectOperationActivity(
    context: InternalContext
  ): Promise<ReadonlyMap<string, number>> {
    const value = await this.request<unknown>(
      "GET",
      workspaceOperationActivityPath(context.tenant.workspaceId),
      context
    );
    const input = exactRecord(value, ["projects"]);
    if (!Array.isArray(input.projects) || input.projects.length > 1_000) {
      throw invalidJobsResponse();
    }
    const counts = new Map<string, number>();
    for (const value of input.projects) {
      const activity = exactRecord(value, ["projectId", "activeOperationCount"]);
      const projectId = uuidValue(activity.projectId);
      if (
        counts.has(projectId) ||
        !Number.isSafeInteger(activity.activeOperationCount) ||
        Number(activity.activeOperationCount) < 1 ||
        Number(activity.activeOperationCount) > 100_000
      ) {
        throw invalidJobsResponse();
      }
      counts.set(projectId, Number(activity.activeOperationCount));
    }
    return counts;
  }

  public async listAdminOperations(
    actorId: string,
    requestId: string,
    query: {
      readonly statusGroup: AdminOperationStatusGroup;
      readonly type?: string;
      readonly cursor?: string;
      readonly limit: number;
    }
  ): Promise<InternalAdminOperationSearchResult> {
    const url = new URL(
      "/internal/v1/platform-admin/operations",
      this.config.services.jobs
    );
    url.searchParams.set("status", query.statusGroup);
    url.searchParams.set("limit", String(query.limit));
    if (query.type) url.searchParams.set("type", query.type);
    if (query.cursor) url.searchParams.set("cursor", query.cursor);
    const value = await this.requestAdmin<unknown>(
      url.toString(),
      actorId,
      requestId
    );
    return adminOperationSearchResult(value, query.limit);
  }

  public async createFrequencyCollection(
    context: InternalContext,
    input: CreateFrequencyCollectionInput,
    idempotencyKey: string,
    jobCapacity: InternalCreateFrequencyCollectionInput["jobCapacity"]
  ): Promise<FrequencyCollectionSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCreateFrequencyCollectionInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      idempotencyKey,
      correlationId: context.requestId,
      jobCapacity
    };
    const value = await this.request<unknown>(
      "POST",
      frequencyCollectionPath(context.tenant.workspaceId, projectId),
      context,
      body,
      "integration-credential",
      idempotencyKey
    );
    return scopedFrequencyCollection(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async createAiAnswerCollection(
    context: InternalContext,
    input: CreateAiAnswerCollectionInput,
    idempotencyKey: string,
    jobCapacity: InternalCreateAiAnswerCollectionInput["jobCapacity"]
  ): Promise<AiAnswerCollectionSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCreateAiAnswerCollectionInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      idempotencyKey,
      correlationId: context.requestId,
      jobCapacity
    };
    const value = await this.request<unknown>(
      "POST",
      aiAnswerCollectionPath(context.tenant.workspaceId, projectId),
      context,
      body,
      "shared",
      idempotencyKey
    );
    return scopedAiAnswerCollection(value, context.tenant.workspaceId, projectId);
  }

  public async createClusteringRun(
    context: InternalContext,
    input: CreateClusteringRunInput,
    idempotencyKey: string,
    jobCapacity: InternalCreateClusteringRunInput["jobCapacity"]
  ): Promise<ClusteringRunSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCreateClusteringRunInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      idempotencyKey,
      correlationId: context.requestId,
      jobCapacity
    };
    const value = await this.request<unknown>(
      "POST",
      clusteringRunPath(context.tenant.workspaceId, projectId),
      context,
      body,
      "shared",
      idempotencyKey,
      CLUSTERING_RUN_CREATE_TIMEOUT_MS
    );
    return scopedClusteringRun(value, context.tenant.workspaceId, projectId);
  }

  public async getClusteringRun(
    context: InternalContext,
    jobId: string
  ): Promise<ClusteringRunSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      `${clusteringRunPath(context.tenant.workspaceId, projectId)}/${encodeURIComponent(jobId)}`,
      context
    );
    return scopedClusteringRun(value, context.tenant.workspaceId, projectId, jobId);
  }

  public async cancelClusteringRun(
    context: InternalContext,
    jobId: string
  ): Promise<ClusteringRunSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCancelClusteringRunInput = {
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId
    };
    const value = await this.request<unknown>(
      "POST",
      `${clusteringRunPath(context.tenant.workspaceId, projectId)}/${encodeURIComponent(jobId)}/cancel`,
      context,
      body
    );
    return scopedClusteringRun(value, context.tenant.workspaceId, projectId, jobId);
  }

  public async getAiAnswerCollection(
    context: InternalContext,
    jobId: string
  ): Promise<AiAnswerCollectionSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      `${aiAnswerCollectionPath(context.tenant.workspaceId, projectId)}/${encodeURIComponent(jobId)}`,
      context
    );
    return scopedAiAnswerCollection(value, context.tenant.workspaceId, projectId, jobId);
  }

  public async getAiAnswerOperationScope(
    context: InternalContext,
    jobId: string,
    limit: number,
    cursor?: string
  ): Promise<InternalAiAnswerOperationScope> {
    const projectId = requiredProjectId(context.tenant);
    const url = new URL(
      `${aiAnswerCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}/${encodeURIComponent(jobId)}/result-scope`,
      this.config.services.jobs
    );
    url.searchParams.set("limit", String(limit));
    if (cursor !== undefined) url.searchParams.set("cursor", cursor);
    const value = await this.request<unknown>("GET", url.toString(), context);
    return scopedAiAnswerOperationScope(
      value,
      context.tenant.workspaceId,
      projectId,
      jobId,
      limit,
      cursor
    );
  }

  public async cancelAiAnswerCollection(
    context: InternalContext,
    jobId: string
  ): Promise<AiAnswerCollectionSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCancelAiAnswerCollectionInput = {
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId
    };
    const value = await this.request<unknown>(
      "POST",
      `${aiAnswerCollectionPath(context.tenant.workspaceId, projectId)}/${encodeURIComponent(jobId)}/cancel`,
      context,
      body
    );
    return scopedAiAnswerCollection(value, context.tenant.workspaceId, projectId, jobId);
  }

  public async getFrequencyCollection(
    context: InternalContext,
    jobId: string
  ): Promise<FrequencyCollectionSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      `${frequencyCollectionPath(context.tenant.workspaceId, projectId)}/${encodeURIComponent(jobId)}`,
      context
    );
    return scopedFrequencyCollection(
      value,
      context.tenant.workspaceId,
      projectId,
      jobId
    );
  }

  public async getFrequencyOperationScope(
    context: InternalContext,
    jobId: string,
    limit: number,
    cursor?: string
  ): Promise<InternalFrequencyOperationScope> {
    const projectId = requiredProjectId(context.tenant);
    const url = new URL(
      `${frequencyCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}/${encodeURIComponent(jobId)}/result-scope`,
      this.config.services.jobs
    );
    url.searchParams.set("limit", String(limit));
    if (cursor !== undefined) url.searchParams.set("cursor", cursor);
    const value = await this.request<unknown>(
      "GET",
      url.toString(),
      context
    );
    return scopedFrequencyOperationScope(
      value,
      context.tenant.workspaceId,
      projectId,
      jobId,
      limit,
      cursor
    );
  }

  public async cancelFrequencyCollection(
    context: InternalContext,
    jobId: string
  ): Promise<FrequencyCollectionSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCancelFrequencyCollectionInput = {
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId
    };
    const value = await this.request<unknown>(
      "POST",
      `${frequencyCollectionPath(context.tenant.workspaceId, projectId)}/${encodeURIComponent(jobId)}/cancel`,
      context,
      body
    );
    return scopedFrequencyCollection(
      value,
      context.tenant.workspaceId,
      projectId,
      jobId
    );
  }

  public async retryFailedFrequencyCollection(
    context: InternalContext,
    jobId: string,
    version: number
  ): Promise<FrequencyCollectionSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalRetryFrequencyCollectionInput = {
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      version
    };
    const value = await this.request<unknown>(
      "POST",
      `${frequencyCollectionPath(context.tenant.workspaceId, projectId)}/${encodeURIComponent(jobId)}/retry-failed`,
      context,
      body
    );
    return scopedFrequencyCollection(
      value,
      context.tenant.workspaceId,
      projectId,
      jobId
    );
  }

  public async createKeywordResearchRun(
    context: InternalContext,
    input: CreateKeywordResearchRunInput,
    idempotencyKey: string,
    jobCapacity: InternalCreateKeywordResearchRunInput["jobCapacity"]
  ): Promise<KeywordResearchRunSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCreateKeywordResearchRunInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      idempotencyKey,
      correlationId: context.requestId,
      jobCapacity
    };
    const value = await this.request<unknown>(
      "POST",
      keywordResearchCollectionPath(context.tenant.workspaceId, projectId),
      context,
      body,
      "integration-credential",
      idempotencyKey
    );
    return scopedKeywordResearchRun(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async getKeywordResearchRun(
    context: InternalContext,
    runId: string
  ): Promise<KeywordResearchRunSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      `${keywordResearchCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}/${encodeURIComponent(runId)}`,
      context,
      undefined,
      "integration-credential"
    );
    return scopedKeywordResearchRun(
      value,
      context.tenant.workspaceId,
      projectId,
      runId
    );
  }

  public async getKeywordResearchRows(
    context: InternalContext,
    runId: string,
    query: Readonly<{ cursor?: number; limit: number }>
  ): Promise<KeywordResearchRowPage> {
    const projectId = requiredProjectId(context.tenant);
    const search = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor !== undefined) search.set("cursor", String(query.cursor));
    const value = await this.request<unknown>(
      "GET",
      `${keywordResearchCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}/${encodeURIComponent(runId)}/rows?${search.toString()}`,
      context,
      undefined,
      "integration-credential"
    );
    return scopedKeywordResearchRowPage(value, query.cursor, query.limit);
  }

  public async confirmKeywordResearchRun(
    context: InternalContext,
    runId: string,
    input: ConfirmKeywordResearchRunInput,
    version: number,
    entitlement: SemanticCapacityEntitlement
  ): Promise<KeywordResearchRunSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalConfirmKeywordResearchRunInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      version,
      entitlement
    };
    const value = await this.request<unknown>(
      "POST",
      `${keywordResearchCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}/${encodeURIComponent(runId)}/confirm`,
      context,
      body,
      "integration-credential"
    );
    return scopedKeywordResearchRun(
      value,
      context.tenant.workspaceId,
      projectId,
      runId
    );
  }

  public async cancelKeywordResearchRun(
    context: InternalContext,
    runId: string,
    version: number
  ): Promise<KeywordResearchRunSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCancelKeywordResearchRunInput = {
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      version
    };
    const value = await this.request<unknown>(
      "POST",
      `${keywordResearchCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}/${encodeURIComponent(runId)}/cancel`,
      context,
      body,
      "integration-credential"
    );
    return scopedKeywordResearchRun(
      value,
      context.tenant.workspaceId,
      projectId,
      runId
    );
  }

  public async retryKeywordResearchImport(
    context: InternalContext,
    runId: string,
    version: number
  ): Promise<KeywordResearchRunSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalRetryKeywordResearchImportInput = {
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      version
    };
    const value = await this.request<unknown>(
      "POST",
      `${keywordResearchCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}/${encodeURIComponent(runId)}/retry-import`,
      context,
      body,
      "integration-credential"
    );
    return scopedKeywordResearchRun(
      value,
      context.tenant.workspaceId,
      projectId,
      runId
    );
  }

  public async createTechnicalCrawl(
    context: InternalContext,
    input: CreateTechnicalCrawlInput,
    idempotencyKey: string,
    jobCapacity: InternalCreateTechnicalCrawlInput["jobCapacity"]
  ): Promise<TechnicalCrawlSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCreateTechnicalCrawlInput = {
      ...input,
      purpose: input.purpose ?? "TECHNICAL_AUDIT",
      maxRuntimeSeconds: input.maxRuntimeSeconds ?? 3_600,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      idempotencyKey,
      correlationId: context.requestId,
      jobCapacity
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

  public async listCrawlAutomations(
    context: InternalContext,
    limit: number
  ): Promise<CrawlAutomationCollection> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      `${crawlAutomationCollectionPath(
        context.tenant.workspaceId,
        projectId
      )}?limit=${encodeURIComponent(String(limit))}`,
      context
    );
    return scopedCrawlAutomationCollection(
      value,
      context.tenant.workspaceId,
      projectId,
      limit
    );
  }

  public async createCrawlAutomation(
    context: InternalContext,
    input: InternalCreateCrawlAutomationInput
  ): Promise<CrawlAutomationSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "POST",
      crawlAutomationCollectionPath(
        context.tenant.workspaceId,
        projectId
      ),
      context,
      input,
      "shared",
      input.idempotencyKey
    );
    return scopedCrawlAutomation(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async updateCrawlAutomation(
    context: InternalContext,
    input: InternalUpdateCrawlAutomationInput
  ): Promise<CrawlAutomationSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "PATCH",
      crawlAutomationPath(
        context.tenant.workspaceId,
        projectId,
        input.automationId
      ),
      context,
      input
    );
    return scopedCrawlAutomation(
      value,
      context.tenant.workspaceId,
      projectId,
      input.automationId
    );
  }

  public async setCrawlAutomationStatus(
    context: InternalContext,
    input: InternalCrawlAutomationStatusInput,
    action: "pause" | "resume"
  ): Promise<CrawlAutomationSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "POST",
      `${crawlAutomationPath(
        context.tenant.workspaceId,
        projectId,
        input.automationId
      )}/${action}`,
      context,
      input
    );
    return scopedCrawlAutomation(
      value,
      context.tenant.workspaceId,
      projectId,
      input.automationId
    );
  }

  public async listCrawlAutomationRuns(
    context: InternalContext,
    automationId: string
  ): Promise<CrawlAutomationRunCollection> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      `${crawlAutomationPath(
        context.tenant.workspaceId,
        projectId,
        automationId
      )}/runs`,
      context
    );
    return scopedCrawlAutomationRuns(
      value,
      context.tenant.workspaceId,
      projectId,
      automationId
    );
  }

  public async runCrawlAutomation(
    context: InternalContext,
    input: InternalRunCrawlAutomationInput
  ): Promise<CrawlAutomationRunSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "POST",
      `${crawlAutomationPath(
        context.tenant.workspaceId,
        projectId,
        input.automationId
      )}/runs`,
      context,
      input,
      "shared",
      input.idempotencyKey
    );
    return scopedCrawlAutomationRun(
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
    idempotencyKey: string,
    jobCapacity: InternalCreateSemanticImportInput["jobCapacity"]
  ): Promise<SemanticImportSummary> {
    const body: InternalCreateSemanticImportInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId: requiredProjectId(context.tenant),
      actorId: context.actorId,
      idempotencyKey,
      jobCapacity
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

  public async createSemanticExport(
    context: InternalContext,
    input: CreateSemanticExportInput,
    idempotencyKey: string,
    jobCapacity: InternalCreateSemanticExportInput["jobCapacity"]
  ): Promise<SemanticExportJobSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCreateSemanticExportInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      idempotencyKey,
      correlationId: context.requestId,
      jobCapacity
    };
    const value = await this.request<unknown>(
      "POST",
      "/internal/v1/semantic-exports",
      context,
      body
    );
    return scopedSemanticExportSummary(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async listSemanticExports(
    context: InternalContext
  ): Promise<SemanticExportCollection> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      "/internal/v1/semantic-exports",
      context
    );
    return scopedSemanticExportCollection(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  public async getSemanticExport(
    context: InternalContext,
    exportId: string
  ): Promise<SemanticExportJobSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.request<unknown>(
      "GET",
      semanticExportPath(exportId),
      context
    );
    return scopedSemanticExportSummary(
      value,
      context.tenant.workspaceId,
      projectId,
      exportId
    );
  }

  public async cancelSemanticExport(
    context: InternalContext,
    exportId: string,
    version: number
  ): Promise<SemanticExportJobSummary> {
    const projectId = requiredProjectId(context.tenant);
    const body: InternalCancelSemanticExportInput = {
      workspaceId: context.tenant.workspaceId,
      projectId,
      actorId: context.actorId,
      version
    };
    const value = await this.request<unknown>(
      "POST",
      `${semanticExportPath(exportId)}/cancel`,
      context,
      body
    );
    return scopedSemanticExportSummary(
      value,
      context.tenant.workspaceId,
      projectId,
      exportId
    );
  }

  public async downloadSemanticExport(
    context: InternalContext,
    exportId: string
  ): Promise<SemanticExportDownload> {
    return semanticExportDownload(
      await this.request<unknown>(
        "GET",
        `${semanticExportPath(exportId)}/download`,
        context
      )
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

  public async workspaceConnectorRouting(
    context: InternalContext
  ): Promise<WorkspaceConnectorRoutingSettings> {
    const value = await this.requestIntegration<unknown>(
      "GET",
      workspaceIntegrationRoutingPath(context),
      context
    );
    return workspaceConnectorRoutingSettings(
      value,
      context.tenant.workspaceId
    );
  }

  public async upsertWorkspaceConnectorBinding(
    context: InternalContext,
    capability: IntegrationCapability,
    input: UpsertWorkspaceConnectorBindingInput
  ): Promise<WorkspaceConnectorBinding> {
    const body: InternalUpsertWorkspaceConnectorBindingInput = {
      ...input,
      workspaceId: context.tenant.workspaceId,
      capability,
      actorId: context.actorId
    };
    const value = await this.requestIntegration<unknown>(
      "PUT",
      `${workspaceIntegrationRoutingPath(context)}/${encodeURIComponent(capability)}`,
      context,
      body
    );
    return workspaceConnectorBinding(value, context.tenant.workspaceId, capability);
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

  public async inheritProjectConnectorBinding(
    context: InternalContext,
    bindingId: string,
    version: number
  ): Promise<ProjectConnectorBinding> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.requestIntegration<unknown>(
      "POST",
      `${projectIntegrationPath(
        context,
        projectId
      )}/${encodeURIComponent(bindingId)}/inherit`,
      context,
      {
        workspaceId: context.tenant.workspaceId,
        projectId,
        actorId: context.actorId,
        version
      }
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

  public async listRankJobs(
    context: InternalContext
  ): Promise<readonly RankJobSummary[]> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.requestIntegration<unknown>(
      "GET",
      rankRunCollectionPath(context.tenant.workspaceId, projectId),
      context
    );
    const input = exactRecord(value, ["jobs"]);
    if (!Array.isArray(input.jobs) || input.jobs.length > 25) {
      throw invalidJobsResponse();
    }
    return input.jobs.map((job) =>
      scopedRankJobSummary(
        job,
        context.tenant.workspaceId,
        projectId
      )
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

  public async getRankRuntimeDiagnostics(
    context: InternalContext,
    jobId: string
  ): Promise<RankRuntimeDiagnostics> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.requestIntegration<unknown>(
      "GET",
      `${rankJobPath(
        context.tenant.workspaceId,
        projectId,
        jobId
      )}/runtime-diagnostics`,
      context
    );
    return scopedRankRuntimeDiagnostics(value, jobId);
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

  public async retryMissingRankJob(
    context: InternalContext,
    input: InternalRetryRankJobInput,
    idempotencyKey: string
  ): Promise<RankJobSummary> {
    const projectId = requiredProjectId(context.tenant);
    const value = await this.requestIntegration<unknown>(
      "POST",
      `${rankJobPath(
        context.tenant.workspaceId,
        projectId,
        input.jobId
      )}/retry-missing`,
      context,
      input,
      idempotencyKey
    );
    return scopedRankJobSummary(
      value,
      context.tenant.workspaceId,
      projectId
    );
  }

  private requestIntegration<Data>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

  private async requestAdmin<Data>(
    path: string,
    actorId: string,
    requestId: string
  ): Promise<Data> {
    const token = this.config.jobsApiToken;
    if (!token) throw dependencyUnavailable();
    const headers = new Headers({
      Accept: "application/json",
      "X-Internal-Token": token,
      "X-Request-Id": requestId,
      "X-Actor-Id": actorId
    });
    let response: Response;
    try {
      response = await fetch(new URL(path, this.config.services.jobs), {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.dependencyTimeoutMs)
      });
    } catch {
      throw dependencyUnavailable();
    }
    const payload = await boundedJobsJson(response);
    if (!response.ok) throw upstreamError(response.status, payload);
    const envelope = allowlistedRecord(payload, ["data", "meta"]);
    if (!Object.hasOwn(envelope, "data")) throw invalidJobsResponse();
    return envelope.data as Data;
  }

  private async request<Data>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    context: InternalContext,
    body?: unknown,
    authentication: "shared" | "integration-credential" = "shared",
    idempotencyKey?: string,
    timeoutMs?: number
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
            timeoutMs ?? (method === "GET"
              ? this.config.dependencyTimeoutMs
              : this.config.internalCommandTimeoutMs)
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

function semanticExportPath(exportId: string): string {
  return `/internal/v1/semantic-exports/${encodeURIComponent(exportId)}`;
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

function adminOperationSearchResult(
  value: unknown,
  limit: number
): InternalAdminOperationSearchResult {
  const input = allowlistedRecord(value, ["data", "nextCursor", "totals", "types"]);
  if (
    !Array.isArray(input.data) ||
    input.data.length > limit ||
    !Array.isArray(input.types) ||
    input.types.length > 50 ||
    (input.nextCursor !== undefined &&
      (typeof input.nextCursor !== "string" || !UUID_PATTERN.test(input.nextCursor)))
  ) {
    throw invalidJobsResponse();
  }
  const totals = exactRecord(input.totals, [
    "total",
    "active",
    "completed",
    "attention"
  ]);
  const parsedTotals = {
    total: nonNegativeInteger(totals.total, 1_000_000_000),
    active: nonNegativeInteger(totals.active, 1_000_000_000),
    completed: nonNegativeInteger(totals.completed, 1_000_000_000),
    attention: nonNegativeInteger(totals.attention, 1_000_000_000)
  };
  const seenTypes = new Set<string>();
  const types = input.types.map((value) => {
    const item = exactRecord(value, ["type", "count"]);
    if (
      typeof item.type !== "string" ||
      !/^[A-Z][A-Z0-9_]{1,99}$/u.test(item.type) ||
      seenTypes.has(item.type)
    ) {
      throw invalidJobsResponse();
    }
    seenTypes.add(item.type);
    return {
      type: item.type,
      count: nonNegativeInteger(item.count, 1_000_000_000)
    };
  });
  return {
    data: input.data.map(adminOperationSummary),
    ...(typeof input.nextCursor === "string"
      ? { nextCursor: input.nextCursor.toLowerCase() }
      : {}),
    totals: parsedTotals,
    types
  };
}

function adminOperationSummary(value: unknown): InternalAdminOperationSummary {
  const input = allowlistedRecord(value, [
    "id",
    "workspaceId",
    "projectId",
    "actorId",
    "type",
    "status",
    "stage",
    "provider",
    "progress",
    "result",
    "errorCode",
    "actualCostMicro",
    "currency",
    "attempt",
    "maxAttempts",
    "createdAt",
    "queuedAt",
    "startedAt",
    "finishedAt",
    "updatedAt"
  ]);
  if (
    typeof input.type !== "string" ||
    !/^[A-Z][A-Z0-9_]{1,99}$/u.test(input.type) ||
    typeof input.status !== "string" ||
    !ADMIN_OPERATION_STATUSES.has(input.status) ||
    (input.stage !== undefined && !shortSafeString(input.stage, 64)) ||
    (input.provider !== undefined && !shortSafeString(input.provider, 64)) ||
    (input.errorCode !== undefined &&
      (typeof input.errorCode !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,99}$/u.test(input.errorCode))) ||
    (input.actualCostMicro !== undefined &&
      !decimalString(input.actualCostMicro)) ||
    (input.currency !== undefined &&
      (typeof input.currency !== "string" || !/^[A-Z]{3}$/u.test(input.currency)))
  ) {
    throw invalidJobsResponse();
  }
  const progress = allowlistedRecord(input.progress, ["current", "total", "unit"]);
  if (
    !decimalString(progress.current) ||
    (progress.total !== undefined && !decimalString(progress.total)) ||
    (progress.unit !== undefined && !shortSafeString(progress.unit, 32))
  ) {
    throw invalidJobsResponse();
  }
  const resultInput = allowlistedRecord(input.result, [
    "processed",
    "succeeded",
    "failed",
    "found",
    "notFound",
    "issues"
  ]);
  const result = Object.fromEntries(
    Object.entries(resultInput).map(([key, count]) => [
      key,
      nonNegativeInteger(count, Number.MAX_SAFE_INTEGER)
    ])
  ) as AdminOperationResultMetrics;
  const projectId = optionalUuid(input.projectId);
  const actorId = optionalUuid(input.actorId);
  const queuedAt = optionalIsoDate(input.queuedAt);
  const startedAt = optionalIsoDate(input.startedAt);
  const finishedAt = optionalIsoDate(input.finishedAt);
  return {
    id: uuidValue(input.id),
    workspaceId: uuidValue(input.workspaceId),
    ...(projectId ? { projectId } : {}),
    ...(actorId ? { actorId } : {}),
    type: input.type,
    status: input.status as AdminOperationStatus,
    ...(typeof input.stage === "string" ? { stage: input.stage } : {}),
    ...(typeof input.provider === "string" ? { provider: input.provider } : {}),
    progress: {
      current: String(progress.current),
      ...(typeof progress.total === "string" ? { total: progress.total } : {}),
      ...(typeof progress.unit === "string" ? { unit: progress.unit } : {})
    },
    result,
    ...(typeof input.errorCode === "string" ? { errorCode: input.errorCode } : {}),
    ...(typeof input.actualCostMicro === "string"
      ? { actualCostMicro: input.actualCostMicro }
      : {}),
    ...(typeof input.currency === "string" ? { currency: input.currency } : {}),
    attempt: nonNegativeInteger(input.attempt, 1_000_000),
    maxAttempts: nonNegativeInteger(input.maxAttempts, 1_000_000),
    createdAt: isoDateValue(input.createdAt),
    ...(queuedAt ? { queuedAt } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    updatedAt: isoDateValue(input.updatedAt)
  };
}

function allowlistedRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = record(value);
  const allowed = new Set(fields);
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    throw invalidJobsResponse();
  }
  return input;
}

function nonNegativeInteger(value: unknown, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  ) {
    throw invalidJobsResponse();
  }
  return Number(value);
}

function decimalString(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d{0,30})$/u.test(value);
}

function shortSafeString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function optionalUuid(value: unknown): string | undefined {
  return value === undefined ? undefined : uuidValue(value);
}

function optionalIsoDate(value: unknown): string | undefined {
  return value === undefined ? undefined : isoDateValue(value);
}

function integrationPath(
  context: InternalContext,
  suffix: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    context.tenant.workspaceId
  )}/integrations/${suffix}`;
}

function workspaceIntegrationRoutingPath(
  context: InternalContext
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    context.tenant.workspaceId
  )}/integration-routing`;
}

function projectIntegrationPath(
  context: InternalContext,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    context.tenant.workspaceId
  )}/projects/${encodeURIComponent(projectId)}/integration-settings`;
}

function projectTransferResetPath(
  workspaceId: string,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(projectId)}/transfer-reset`;
}

function workspaceOperationActivityPath(workspaceId: string): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/operation-activity`;
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

function crawlAutomationCollectionPath(
  workspaceId: string,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(projectId)}/crawl-automations`;
}

function crawlCollectionPath(
  workspaceId: string,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(projectId)}/crawls`;
}

function keywordResearchCollectionPath(
  workspaceId: string,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(projectId)}/keyword-research-runs`;
}

function frequencyCollectionPath(
  workspaceId: string,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(projectId)}/frequency-collections`;
}

function aiAnswerCollectionPath(
  workspaceId: string,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(projectId)}/ai-answer-collections`;
}

function clusteringRunPath(
  workspaceId: string,
  projectId: string
): string {
  return `/internal/v1/workspaces/${encodeURIComponent(
    workspaceId
  )}/projects/${encodeURIComponent(projectId)}/clustering-runs`;
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
    "actorId",
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
  const configKeys = Object.keys(configInput).length;
  const config =
    configKeys === 5
      ? exactRecord(configInput, [
          "startUrls",
          "maxUrls",
          "maxDepth",
          "requestsPerMinute",
          "obeyRobots"
        ])
      : configKeys === 9
        ? exactRecord(configInput, [
            "startUrls",
            "sitemapUrls",
            "includePatterns",
            "excludePatterns",
            "queryPolicy",
            "maxUrls",
            "maxDepth",
            "requestsPerMinute",
            "obeyRobots"
          ])
        : configKeys === 10
          ? exactRecord(configInput, [
              "startUrls",
              "sitemapUrls",
              "includePatterns",
              "excludePatterns",
              "queryPolicy",
              "maxUrls",
              "maxDepth",
              "maxRuntimeSeconds",
              "requestsPerMinute",
              "obeyRobots"
            ])
          : configKeys === 13
            ? exactRecord(configInput, [
                "purpose",
                "startUrls",
                "homepageChecks",
                "sitemapUrls",
                "includePatterns",
                "excludePatterns",
                "queryPolicy",
                "maxUrls",
                "maxDepth",
                "maxRuntimeSeconds",
                "requestsPerMinute",
                "obeyRobots",
                "savePageMap"
              ])
            : configKeys === 12 && "savePageMap" in configInput
              ? exactRecord(configInput, [
                  "purpose",
                  "startUrls",
                  "sitemapUrls",
                  "includePatterns",
                  "excludePatterns",
                  "queryPolicy",
                  "maxUrls",
                  "maxDepth",
                  "maxRuntimeSeconds",
                  "requestsPerMinute",
                  "obeyRobots",
                  "savePageMap"
                ])
              : configKeys === 12
                ? exactRecord(configInput, [
                    "purpose",
                    "startUrls",
                    "homepageChecks",
                    "sitemapUrls",
                    "includePatterns",
                    "excludePatterns",
                    "queryPolicy",
                    "maxUrls",
                    "maxDepth",
                    "maxRuntimeSeconds",
                    "requestsPerMinute",
                    "obeyRobots"
                  ])
                : exactRecord(configInput, [
                    "purpose",
                    "startUrls",
                    "sitemapUrls",
                    "includePatterns",
                    "excludePatterns",
                    "queryPolicy",
                    "maxUrls",
                    "maxDepth",
                    "maxRuntimeSeconds",
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
  const purpose = config.purpose ?? "TECHNICAL_AUDIT";
  const savePageMap = config.savePageMap ?? true;
  const homepageChecks = Array.isArray(config.homepageChecks)
    ? config.homepageChecks
    : [];
  const failureCode =
    typeof input.failureCode === "string" &&
    [
      "ROBOTS_UNAVAILABLE",
      "SITEMAP_UNAVAILABLE",
      "CRAWL_EXECUTION_FAILED",
      "MAX_RUNTIME_EXCEEDED"
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
      "LATENCY_SPIKE",
      "SITE_PAUSED"
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
    startUrls.length > technicalCrawlStartUrlLimit ||
    sitemapUrls.length > 10 ||
    new Set(startUrls).size !== startUrls.length ||
    new Set(sitemapUrls).size !== sitemapUrls.length ||
    new Set([...startUrls, ...sitemapUrls].map(
      (url) => new URL(url).origin
    )).size !== 1 ||
    !technicalCrawlQueryPolicies.includes(
      queryPolicy as (typeof technicalCrawlQueryPolicies)[number]
    ) ||
    !technicalCrawlPurposes.includes(
      purpose as (typeof technicalCrawlPurposes)[number]
    ) ||
    (config.homepageChecks !== undefined &&
      !Array.isArray(config.homepageChecks)) ||
    homepageChecks.length > technicalCrawlHomepageChecks.length ||
    homepageChecks.some(
      (check) =>
        typeof check !== "string" ||
        !technicalCrawlHomepageChecks.includes(
          check as (typeof technicalCrawlHomepageChecks)[number]
        )
    ) ||
    new Set(homepageChecks).size !== homepageChecks.length ||
    (purpose !== "HTTP_STATUS_CHECK" && homepageChecks.length > 0) ||
    new Set([
      ...startUrls,
      ...technicalCrawlHomepageProbeUrls(
        startUrls[0]!,
        homepageChecks as (typeof technicalCrawlHomepageChecks)[number][]
      )
    ]).size > Number(config.maxUrls) ||
    config.obeyRobots !== true ||
    typeof savePageMap !== "boolean"
  ) {
    throw invalidJobsResponse();
  }
  const summary: TechnicalCrawlSummary = {
    id,
    jobId: uuidValue(input.jobId),
    workspaceId: responseWorkspaceId,
    projectId: responseProjectId,
    ...(input.actorId === undefined
      ? {}
      : { actorId: uuidValue(input.actorId) }),
    status: input.status as TechnicalCrawlSummary["status"],
    config: {
      purpose: purpose as TechnicalCrawlSummary["config"]["purpose"],
      startUrls,
      ...(homepageChecks.length > 0
        ? {
            homepageChecks:
              homepageChecks as NonNullable<
                TechnicalCrawlSummary["config"]["homepageChecks"]
              >
          }
        : {}),
      sitemapUrls,
      includePatterns,
      excludePatterns,
      queryPolicy:
        queryPolicy as TechnicalCrawlSummary["config"]["queryPolicy"],
      maxUrls: boundedPositiveInteger(config.maxUrls, technicalCrawlMaxUrlLimit),
      maxDepth: boundedNonNegativeInteger(config.maxDepth, 10),
      maxRuntimeSeconds: boundedPositiveInteger(
        config.maxRuntimeSeconds ?? 3_600,
        21_600
      ),
      requestsPerMinute: boundedPositiveInteger(
        config.requestsPerMinute,
        technicalCrawlMaxRequestsPerMinute
      ),
      obeyRobots: true,
      savePageMap
    },
    discoveredUrls: boundedNonNegativeInteger(input.discoveredUrls, technicalCrawlMaxUrlLimit),
    processedUrls: boundedNonNegativeInteger(input.processedUrls, technicalCrawlMaxUrlLimit),
    successfulUrls: boundedNonNegativeInteger(input.successfulUrls, technicalCrawlMaxUrlLimit),
    failedUrls: boundedNonNegativeInteger(input.failedUrls, technicalCrawlMaxUrlLimit),
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

function crawlAutomationPath(
  workspaceId: string,
  projectId: string,
  automationId: string
): string {
  return `${crawlAutomationCollectionPath(
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
    if (code === "PROJECT_TRANSFER_ACTIVE_OPERATIONS") {
      return new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "Project has active operations",
        details: { reason: "ACTIVE_OPERATIONS" }
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
    for (const route of projectBindingRoutes(binding)) {
      const credential = credentialsById.get(route.credentialId);
      if (
        credential &&
        (credential.provider !== route.provider ||
          credential.mode !== route.credentialMode)
      ) {
        throw invalidJobsResponse();
      }
    }
    if (
      binding.availability !==
      expectedProjectBindingAvailability(binding, credentialsById)
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

function workspaceConnectorRoutingSettings(
  value: unknown,
  workspaceId: string
): WorkspaceConnectorRoutingSettings {
  const input = exactRecord(value, [
    "bindings",
    "credentialOptions",
    "credentialOptionsTruncated",
    "access"
  ]);
  if (
    !Array.isArray(input.bindings) ||
    input.bindings.length > integrationCapabilities.length ||
    !Array.isArray(input.credentialOptions) ||
    input.credentialOptions.length > MAX_PROJECT_CREDENTIAL_OPTIONS ||
    typeof input.credentialOptionsTruncated !== "boolean"
  ) {
    throw invalidJobsResponse();
  }
  const access = exactRecord(input.access, [
    "canUpdateBindings",
    "canManageFallback"
  ]);
  if (
    typeof access.canUpdateBindings !== "boolean" ||
    typeof access.canManageFallback !== "boolean"
  ) {
    throw invalidJobsResponse();
  }
  const bindings = input.bindings.map((binding) =>
    workspaceConnectorBinding(binding, workspaceId)
  );
  const credentialOptions = input.credentialOptions.map((credential) =>
    projectConnectorCredentialOption(credential, workspaceId)
  );
  assertUnique(
    bindings.map(({ id }) => id),
    bindings.map(({ capability }) => capability),
    credentialOptions.map(({ id }) => id)
  );
  return {
    bindings,
    credentialOptions,
    credentialOptionsTruncated: input.credentialOptionsTruncated,
    access: {
      canUpdateBindings: access.canUpdateBindings,
      canManageFallback: access.canManageFallback
    }
  };
}

function workspaceConnectorBinding(
  value: unknown,
  workspaceId: string,
  expectedCapability?: IntegrationCapability
): WorkspaceConnectorBinding {
  const input = exactRecord(value, [
    "id",
    "workspaceId",
    "capability",
    "enabled",
    "routes",
    "fallbackPolicy",
    "version",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt"
  ]);
  const responseWorkspaceId = uuidValue(input.workspaceId);
  const id = uuidValue(input.id);
  const capability = capabilityValue(input.capability);
  if (
    responseWorkspaceId !== workspaceId ||
    (expectedCapability !== undefined && capability !== expectedCapability) ||
    typeof input.enabled !== "boolean" ||
    !Array.isArray(input.routes) ||
    input.routes.length < 1 ||
    input.routes.length > 8
  ) {
    throw invalidJobsResponse();
  }
  const routes = input.routes.map((route, index) => {
    const parsed = workspaceConnectorRoute(route, workspaceId, id);
    if (parsed.position !== index) throw invalidJobsResponse();
    return parsed;
  });
  if (new Set(routes.map(({ credentialId }) => credentialId)).size !== routes.length) {
    throw invalidJobsResponse();
  }
  return {
    id,
    workspaceId,
    capability,
    enabled: input.enabled,
    routes,
    fallbackPolicy: projectFallbackPolicy(input.fallbackPolicy),
    version: positiveInteger(input.version),
    createdBy: uuidValue(input.createdBy),
    updatedBy: uuidValue(input.updatedBy),
    createdAt: isoDateValue(input.createdAt),
    updatedAt: isoDateValue(input.updatedAt)
  };
}

function workspaceConnectorRoute(
  value: unknown,
  workspaceId: string,
  bindingId: string
): WorkspaceConnectorRoute {
  const input = exactRecord(value, [
    "id",
    "bindingId",
    "workspaceId",
    "position",
    "credentialId",
    "provider",
    "credentialMode",
    "availability",
    "createdAt",
    "updatedAt"
  ]);
  if (
    uuidValue(input.workspaceId) !== workspaceId ||
    uuidValue(input.bindingId) !== bindingId ||
    !Number.isSafeInteger(input.position) ||
    Number(input.position) < 0 ||
    Number(input.position) > 7
  ) {
    throw invalidJobsResponse();
  }
  return {
    id: uuidValue(input.id),
    bindingId,
    workspaceId,
    position: Number(input.position),
    credentialId: uuidValue(input.credentialId),
    provider: providerValue(input.provider),
    credentialMode: credentialModeValue(input.credentialMode),
    availability: projectBindingAvailabilityValue(input.availability),
    createdAt: isoDateValue(input.createdAt),
    updatedAt: isoDateValue(input.updatedAt)
  };
}

function expectedProjectBindingAvailability(
  binding: ProjectConnectorBinding,
  credentials: ReadonlyMap<string, ProjectConnectorCredentialOption>
): ProjectConnectorBinding["availability"] {
  if (!binding.enabled) return "DISABLED";
  const routes = projectBindingRoutes(binding);
  const values = routes.map((route) => routeAvailability(
    binding.capability,
    credentials.get(route.credentialId)
  ));
  const primary = values[0] ?? "CREDENTIAL_UNAVAILABLE";
  if (primary === "READY" || binding.fallbackPolicy.mode === "NONE") {
    return primary;
  }
  return values.slice(1).includes("READY") ? "READY" : primary;
}

function projectBindingRoutes(
  binding: ProjectConnectorBinding
): readonly ProjectConnectorRoute[] {
  return binding.routes ?? (binding.route ? [binding.route] : []);
}

function routeAvailability(
  capability: ProjectConnectorBinding["capability"],
  credential: ProjectConnectorCredentialOption | undefined
): ProjectConnectorBinding["availability"] {
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
  return credential.capabilities.includes(capability)
    ? "READY"
    : "CAPABILITY_MISMATCH";
}

function scopedProjectConnectorBinding(
  value: unknown,
  workspaceId: string,
  projectId: string,
  bindingId?: string
): ProjectConnectorBinding {
  const rawBinding = unknownRecord(value);
  const hasRoute = rawBinding !== undefined && "route" in rawBinding;
  const hasRoutes = rawBinding !== undefined && "routes" in rawBinding;
  const hasConfigurationScope = rawBinding !== undefined && "configurationScope" in rawBinding;
  const hasWorkspaceBindingId = rawBinding !== undefined && "workspaceBindingId" in rawBinding;
  const input = exactRecord(value, [
    "id",
    "workspaceId",
    "projectId",
    "capability",
    "enabled",
    ...(hasConfigurationScope ? ["configurationScope"] : []),
    ...(hasWorkspaceBindingId ? ["workspaceBindingId"] : []),
    ...(hasRoute ? ["route"] : []),
    ...(hasRoutes ? ["routes"] : []),
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
  const declaredRoute = hasRoute
    ? projectConnectorRoute(
        input.route,
        responseWorkspaceId,
        responseProjectId,
        id
      )
    : undefined;
  const routeValues = hasRoutes
    ? input.routes
    : declaredRoute
      ? [input.route]
      : [];
  if (!Array.isArray(routeValues) || routeValues.length > 8) {
    throw invalidJobsResponse();
  }
  const routes = routeValues.map((candidate, index) => {
    const parsed = projectConnectorRoute(
      candidate,
      responseWorkspaceId,
      responseProjectId,
      id
    );
    if (parsed.position !== index) throw invalidJobsResponse();
    return parsed;
  });
  if (
    (declaredRoute === undefined) !== (routes.length === 0) ||
    (declaredRoute && routes[0]?.id !== declaredRoute.id) ||
    new Set(routes.map(({ credentialId }) => credentialId)).size !== routes.length
  ) {
    throw invalidJobsResponse();
  }
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
  const configurationScope = hasConfigurationScope
    ? input.configurationScope
    : "PROJECT_OVERRIDE";
  if (
    configurationScope !== "PROJECT_OVERRIDE" &&
    configurationScope !== "WORKSPACE_INHERITED"
  ) {
    throw invalidJobsResponse();
  }
  const workspaceBindingId = hasWorkspaceBindingId
    ? uuidValue(input.workspaceBindingId)
    : undefined;
  if (
    (configurationScope === "PROJECT_OVERRIDE" && workspaceBindingId !== undefined) ||
    (configurationScope === "WORKSPACE_INHERITED" && workspaceBindingId === undefined)
  ) {
    throw invalidJobsResponse();
  }
  const fallbackPolicy = projectFallbackPolicy(input.fallbackPolicy);
  const budgetPolicy = projectBudgetPolicy(input.budgetPolicy);
  if (
    routes.length === 0 &&
    (input.enabled !== false ||
      availability !== "DISABLED" ||
      configurationScope !== "PROJECT_OVERRIDE" ||
      workspaceBindingId !== undefined ||
      fallbackPolicy.mode !== "NONE" ||
      (fallbackPolicy.reasons?.length ?? 0) !== 0)
  ) {
    throw invalidJobsResponse();
  }
  return {
    id,
    workspaceId: responseWorkspaceId,
    projectId: responseProjectId,
    capability,
    enabled: input.enabled,
    configurationScope,
    ...(workspaceBindingId ? { workspaceBindingId } : {}),
    ...(declaredRoute ? { route: declaredRoute } : {}),
    routes,
    fallbackPolicy,
    budgetPolicy,
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
  const rawRoute = unknownRecord(value);
  const hasRoutingScope = rawRoute !== undefined && "routingScope" in rawRoute;
  const hasWorkspaceRouteId = rawRoute !== undefined && "workspaceRouteId" in rawRoute;
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
    ...(hasRoutingScope ? ["routingScope"] : []),
    ...(hasWorkspaceRouteId ? ["workspaceRouteId"] : []),
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
    !Number.isSafeInteger(input.position) ||
    Number(input.position) < 0 ||
    Number(input.position) > 7
  ) {
    throw invalidJobsResponse();
  }
  const routingScope = hasRoutingScope
    ? connectorRoutingScopeValue(input.routingScope)
    : undefined;
  const workspaceRouteId = hasWorkspaceRouteId
    ? uuidValue(input.workspaceRouteId)
    : undefined;
  return {
    id: uuidValue(input.id),
    bindingId: routeBindingId,
    workspaceId: routeWorkspaceId,
    projectId: routeProjectId,
    position: Number(input.position),
    sourceKind,
    credentialId: uuidValue(input.credentialId),
    provider: providerValue(input.provider),
    credentialMode,
    ...(routingScope ? { routingScope } : {}),
    ...(workspaceRouteId ? { workspaceRouteId } : {}),
    createdAt: isoDateValue(input.createdAt),
    updatedAt: isoDateValue(input.updatedAt)
  };
}

function projectConnectorCredentialOption(
  value: unknown,
  workspaceId: string
): ProjectConnectorCredentialOption {
  const rawOption = unknownRecord(value);
  const hasQuota = rawOption !== undefined && "quota" in rawOption;
  const input = exactRecord(value, [
    "id",
    "workspaceId",
    "provider",
    "label",
    "mode",
    "status",
    "capabilities",
    ...(hasQuota ? ["quota"] : [])
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
  const quota = hasQuota
    ? credentialQuotaSummary(input.quota)
    : undefined;
  return {
    id: uuidValue(input.id),
    workspaceId: responseWorkspaceId,
    provider: providerValue(input.provider),
    label: input.label,
    mode: credentialModeValue(input.mode),
    status: credentialStatusValue(input.status),
    capabilities:
      capabilities as ProjectConnectorCredentialOption["capabilities"],
    ...(quota ? { quota } : {})
  };
}

function projectFallbackPolicy(
  value: unknown
): ProjectConnectorFallbackPolicy {
  const rawPolicy = unknownRecord(value);
  const hasReasons = rawPolicy !== undefined && "reasons" in rawPolicy;
  const input = exactRecord(value, ["mode", ...(hasReasons ? ["reasons"] : [])]);
  const reasons = hasReasons ? input.reasons : [];
  if (
    typeof input.mode !== "string" ||
    !CONNECTOR_FALLBACK_MODES.has(input.mode) ||
    !Array.isArray(reasons) ||
    reasons.some((reason) => typeof reason !== "string" || !CONNECTOR_FALLBACK_REASONS.has(reason)) ||
    new Set(reasons).size !== reasons.length ||
    (input.mode === "NONE" && reasons.length > 0)
  ) {
    throw invalidJobsResponse();
  }
  return {
    mode: input.mode as ProjectConnectorFallbackPolicy["mode"],
    reasons: reasons as readonly ConnectorFallbackReason[]
  };
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

function connectorRoutingScopeValue(
  value: unknown
): ProjectConnectorRoute["routingScope"] {
  if (typeof value !== "string" || !CONNECTOR_ROUTING_SCOPES.has(value)) {
    throw invalidJobsResponse();
  }
  return value as NonNullable<ProjectConnectorRoute["routingScope"]>;
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
  const quota = credentialQuotaSummary(input.quota);
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
    quota,
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

function credentialQuotaSummary(
  value: unknown
): IntegrationCredentialSummary["quota"] {
  const input = record(value);
  if (input.status === "NOT_AVAILABLE") {
    if (Object.keys(input).length !== 1) throw invalidJobsResponse();
    return { status: "NOT_AVAILABLE" };
  }
  const balance =
    input.balance === undefined
      ? undefined
      : credentialProviderBalance(input.balance);
  if (
    input.status !== "AVAILABLE" ||
    ![
      "ARSENKIN_LIMITS",
      "API_REQUESTS",
      "XMLSTOCK_REQUESTS"
    ].includes(String(input.unit)) ||
    !Number.isSafeInteger(input.remaining) ||
    Number(input.remaining) < 0 ||
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) || Number(input.limit) < 0)) ||
    (input.used !== undefined &&
      (!Number.isSafeInteger(input.used) || Number(input.used) < 0)) ||
    !optionalNonNegativeInteger(input.usedToday) ||
    !optionalNonNegativeInteger(input.usedMonth) ||
    !optionalNonNegativeInteger(input.frozenRemaining) ||
    !optionalNonNegativeInteger(input.tariffDaysRemaining) ||
    (input.observedAt !== undefined &&
      (typeof input.observedAt !== "string" || !isIsoDate(input.observedAt)))
  ) {
    throw invalidJobsResponse();
  }
  return {
    status: "AVAILABLE",
    unit: input.unit as
      | "ARSENKIN_LIMITS"
      | "API_REQUESTS"
      | "XMLSTOCK_REQUESTS",
    remaining: Number(input.remaining),
    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    ...(typeof input.used === "number" ? { used: input.used } : {}),
    ...(balance ? { balance } : {}),
    ...(typeof input.usedToday === "number"
      ? { usedToday: input.usedToday }
      : {}),
    ...(typeof input.usedMonth === "number"
      ? { usedMonth: input.usedMonth }
      : {}),
    ...(typeof input.frozenRemaining === "number"
      ? { frozenRemaining: input.frozenRemaining }
      : {}),
    ...(typeof input.tariffDaysRemaining === "number"
      ? { tariffDaysRemaining: input.tariffDaysRemaining }
      : {}),
    ...(typeof input.observedAt === "string"
      ? { observedAt: input.observedAt }
      : {})
  };
}

function credentialProviderBalance(
  value: unknown
): {
  readonly amount: string;
  readonly frozenAmount?: string;
  readonly currency: "RUB";
} {
  const input = record(value);
  const allowed = new Set(["amount", "frozenAmount", "currency"]);
  if (
    Object.keys(input).some((field) => !allowed.has(field)) ||
    typeof input.amount !== "string" ||
    !NON_NEGATIVE_MONEY_PATTERN.test(input.amount) ||
    (input.frozenAmount !== undefined &&
      (typeof input.frozenAmount !== "string" ||
        !NON_NEGATIVE_MONEY_PATTERN.test(input.frozenAmount))) ||
    input.currency !== "RUB"
  ) {
    throw invalidJobsResponse();
  }
  return {
    amount: input.amount,
    ...(typeof input.frozenAmount === "string"
      ? { frozenAmount: input.frozenAmount }
      : {}),
    currency: "RUB"
  };
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && Number(value) >= 0)
  );
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
