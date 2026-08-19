import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  semanticKeywordIntents,
  semanticKeywordCreateOutcomes,
  semanticKeywordCleaningStates,
  semanticKeywordSourceModes,
  semanticKeywordPageSizes,
  semanticKeywordSorts,
  semanticClusterMethods,
  semanticClusterPageSources,
  semanticClusterPageBulkStates,
  semanticClusterMergeReadiness,
  semanticClusterSplitReadiness,
  semanticClusterSplitSourceStates,
  pageIndexabilities,
  pageTypes,
  semanticCustomColumnTypes,
  semanticSavedViewDensities,
  semanticSavedViewGroupSidebarWidthMax,
  semanticSavedViewGroupSidebarWidthMin,
  semanticSavedViewScopes,
  semanticNegativeKeywordMatchModes,
  semanticDuplicatePreviewPageSizes,
  semanticSystemColumnKeys,
  type ApiCollectionResponse,
  type CreateSemanticKeywordInput,
  type CreateSemanticClusterInput,
  type CreateSemanticKeywordGroupInput,
  type InternalCreateSemanticKeywordInput,
  type InternalSemanticKeywordBulkCreateInput,
  type InternalCreateSemanticClusterInput,
  type InternalCreateSemanticKeywordGroupInput,
  type InternalDeleteSemanticKeywordInput,
  type InternalDeleteSemanticClusterInput,
  type InternalSemanticClusterMergeInput,
  type InternalSemanticClusterSplitInput,
  type InternalDeleteSemanticKeywordGroupInput,
  type InternalSemanticKeywordBulkInput,
  type InternalSemanticKeywordCleaningInput,
  type InternalCreateSemanticSavedViewInput,
  type InternalCreateSemanticCustomColumnInput,
  type InternalDeleteSemanticSavedViewInput,
  type InternalDeleteSemanticCustomColumnInput,
  type InternalDeleteSemanticKeywordCustomValueInput,
  type InternalSetSemanticKeywordCustomValueInput,
  type InternalUpdateSemanticSavedViewInput,
  type InternalUpdateSemanticCustomColumnInput,
  type InternalUpdateSemanticKeywordInput,
  type InternalCreateSemanticNegativeKeywordPresetInput,
  type InternalUpdateSemanticNegativeKeywordPresetInput,
  type InternalDeleteSemanticNegativeKeywordPresetInput,
  type InternalSemanticNegativeKeywordPreviewInput,
  type InternalApplySemanticNegativeKeywordsInput,
  type InternalUpdateSemanticClusterInput,
  type InternalUpdateSemanticKeywordGroupInput,
  type CreateTrackingContextInput,
  type InternalChangeTrackingContextKeywordInput,
  type InternalChangeTrackingContextStatusInput,
  type InternalChangeProjectPageStatusInput,
  type InternalCreateProjectPageInput,
  type InternalCreateTrackingContextInput,
  type InternalReplaceTrackingContextKeywordsInput,
  type InternalUpdateProjectPageInput,
  type InternalUpdateTrackingContextInput,
  type InternalCrawlOperationResultPage,
  type InternalAiAnswerOperationResult,
  type InternalAiAnswerOperationResultInput,
  type InternalFrequencyOperationResult,
  type InternalFrequencyOperationResultInput,
  type InternalRankOperationResult,
  type InternalProjectWorkspaceTransferInput,
  type InternalProjectSeoTransferResult,
  type KeywordListQuery,
  type RankHistoryQuery,
  type CreateProjectPageInput,
  type ProjectPageCollection,
  type ProjectPageListQuery,
  type ProjectPageSummary,
  type ProjectPositionSummary,
  type ProjectCrawlAbsentPageCollection,
  type ProjectCrawlDuplicateGroupCollection,
  type ProjectCrawlPageChangeCollection,
  type ProjectCrawlIssueCollection,
  type SemanticKeywordIntent,
  type SemanticCluster,
  type SemanticClusterMergeInput,
  type SemanticClusterMergePreview,
  type SemanticClusterMergeResult,
  type SemanticClusterSplitInput,
  type SemanticClusterSplitPreview,
  type SemanticClusterSplitResult,
  type SemanticClusterPageBulkInput,
  type SemanticClusterPageBulkPreview,
  type SemanticClusterPageBulkResult,
  type SemanticClusterPageSource,
  type SemanticKeywordBulkInput,
  type SemanticKeywordBulkCreateInput,
  type SemanticKeywordBulkCreateResult,
  type SemanticKeywordBulkResult,
  type SemanticKeywordCleaningInput,
  type SemanticKeywordCleaningPreview,
  type SemanticKeywordCleaningResult,
  type SemanticKeywordGroup,
  type SemanticKeywordListItem,
  type SemanticKeywordInsights,
  type SemanticFrequencyDevice,
  type SemanticFrequencyType,
  type CreateSemanticSavedViewInput,
  type CreateSemanticCustomColumnInput,
  type SemanticCustomColumn,
  type SemanticCustomColumnConfig,
  type SemanticKeywordCustomValue,
  type SemanticSavedView,
  type SemanticSavedViewConfig,
  type SemanticCapacityEntitlement,
  type SemanticVersionListItem,
  type SemanticVersionDetail,
  type SemanticVersionUndoPreview,
  type SemanticVersionUndoResult,
  type UpdateSemanticSavedViewInput,
  type SetSemanticKeywordCustomValueInput,
  type UpdateSemanticCustomColumnInput,
  type TrackingContextCollection,
  type TrackingContextKeywordAssignmentState,
  type TrackingContextKeywordReplacementResult,
  type TrackingContextKeywordQuery,
  type TrackingContextSummary,
  type ReplaceTrackingContextKeywordsInput,
  type UpdateSemanticKeywordInput,
  type UpdateSemanticClusterInput,
  type UpdateProjectPageInput,
  type UpdateSemanticKeywordGroupInput,
  type UpdateTrackingContextInput,
  type CreateSemanticNegativeKeywordPresetInput,
  type UpdateSemanticNegativeKeywordPresetInput,
  type SemanticNegativeKeywordPreviewInput,
  type ApplySemanticNegativeKeywordsInput,
  type SemanticNegativeKeywordPreset,
  type SemanticNegativeKeywordPreview,
  type SemanticNegativeKeywordApplyResult,
  type SemanticDuplicatePreviewInput,
  type ApplySemanticDuplicatesInput,
  type InternalSemanticDuplicatePreviewInput,
  type InternalApplySemanticDuplicatesInput,
  type SemanticDuplicatePreview,
  type SemanticDuplicateApplyResult,
  type SemanticDuplicatePreviewGroup,
  type SemanticDuplicatePreviewItem,
  type CreateProjectNoteInput,
  type UpdateProjectNoteInput,
  type InternalCreateProjectNoteInput,
  type InternalUpdateProjectNoteInput,
  type InternalDeleteProjectNoteInput,
  type ProjectNoteCollection,
  type ProjectNoteSummary,
  type PublicProjectNote,
  type AdminProjectSemanticCounts,
  type AiAnswerHistoryCursorPage,
  type AiAnswerHistoryQuery,
  type SemanticAiAnswerCompetitorSnapshot,
  type SemanticAiAnswerDetail,
  type SemanticAiAnswerHistoryItem
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
  scopedTrackingContextKeywordReplacement,
  trackingContextCollection,
  trackingContextKeywordPage,
  type TrackingContextKeywordPage
} from "../rankings/tracking-context-response.js";
import {
  semanticVersionDetailResponse,
  semanticVersionsResponse,
  semanticVersionUndoPreviewResponse,
  semanticVersionUndoResultResponse
} from "../semantics/semantic-version-response.js";
import {
  scopedProjectPage,
  scopedProjectPageCollection
} from "../pages/page-response.js";
import { crawlIssueCollection } from "../crawls/crawl-issue-response.js";
import { crawlPageChangeCollection } from "../crawls/crawl-change-response.js";
import { crawlDuplicateGroupCollection } from "../crawls/crawl-duplicate-response.js";
import { crawlAbsentPageCollection } from "../crawls/crawl-absence-response.js";
import {
  scopedInternalAiAnswerOperationResult,
  scopedInternalCrawlOperationResultPage,
  scopedInternalFrequencyOperationResult,
  scopedInternalRankOperationResult
} from "./operation-result-response.js";
import {
  projectNote,
  projectNoteCollection,
  publicProjectNote
} from "../notes/project-note-response.js";

interface InternalContext {
  readonly tenant: TenantAuthorization;
  readonly actorId: string;
  readonly requestId: string;
}

interface KeywordPage {
  readonly data: readonly SemanticKeywordListItem[];
  readonly page: ApiCollectionResponse<SemanticKeywordListItem>["page"];
}

interface AiAnswerHistoryPage {
  readonly data: readonly SemanticAiAnswerHistoryItem[];
  readonly page: AiAnswerHistoryCursorPage;
}

const ADMIN_PROJECT_LIMIT = 50;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const SEO_DATA_REQUEST_TRANSPORT = Symbol(
  "SEO_DATA_REQUEST_TRANSPORT"
);

export interface SeoDataTransportRequest {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
}

export interface SeoDataTransportResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface SeoDataRequestTransport {
  request(input: SeoDataTransportRequest): Promise<SeoDataTransportResponse>;
}

@Injectable()
export class SeoDataClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional()
    @Inject(SEO_DATA_REQUEST_TRANSPORT)
    private readonly transport?: SeoDataRequestTransport
  ) {}

  public async transferProjectWorkspace(
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
    const payload = await this.request(
      "POST",
      new URL(
        `/internal/v1/projects/${encodeURIComponent(input.projectId)}/workspace-transfer`,
        this.config.services.seoData
      ),
      context,
      input
    );
    const data = responseData(payload) as Partial<InternalProjectSeoTransferResult>;
    if (
      data.status !== "TRANSFERRED" ||
      !Number.isSafeInteger(data.affectedRows) ||
      Number(data.affectedRows) < 0
    ) {
      throw invalidResponse();
    }
  }

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
    if (query.tag) url.searchParams.set("tag", query.tag);
    if (query.intent) url.searchParams.set("intent", query.intent);
    if (query.groupId) url.searchParams.set("groupId", query.groupId);
    if (query.groupIds?.length) {
      url.searchParams.set("groupIds", query.groupIds.join(","));
    }
    if (query.clusterId) url.searchParams.set("clusterId", query.clusterId);
    if (query.isFavorite !== undefined) {
      url.searchParams.set("isFavorite", String(query.isFavorite));
    }
    if (query.isTracked !== undefined) {
      url.searchParams.set("isTracked", String(query.isTracked));
    }
    if (query.priorityMin !== undefined) {
      url.searchParams.set("priorityMin", String(query.priorityMin));
    }
    if (query.priorityMax !== undefined) {
      url.searchParams.set("priorityMax", String(query.priorityMax));
    }
    if (query.sort) url.searchParams.set("sort", query.sort);

    const payload = await this.request("GET", url, context);
    return semanticKeywordPage(payload);
  }

  public async listKeywordTagOptions(
    context: InternalContext,
    search?: string
  ): Promise<readonly string[]> {
    const projectId = requiredProjectId(context.tenant);
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(projectId)}/keywords/tag-options`,
      this.config.services.seoData
    );
    if (search) url.searchParams.set("search", search);
    const payload = await this.request("GET", url, context);
    const data = responseData(payload);
    if (
      !Array.isArray(data) ||
      data.length > 100 ||
      !data.every(
        (tag) => typeof tag === "string" && tag.length > 0 && tag.length <= 160
      )
    ) {
      throw invalidResponse();
    }
    return data as readonly string[];
  }

  public async projectPositionSummary(
    context: InternalContext
  ): Promise<ProjectPositionSummary> {
    const projectId = requiredProjectId(context.tenant);
    const payload = await this.request(
      "GET",
      new URL(
        `/internal/v1/projects/${encodeURIComponent(projectId)}/keywords/position-summary`,
        this.config.services.seoData
      ),
      context
    );
    return projectPositionSummary(responseData(payload));
  }

  public async keywordInsights(
    context: InternalContext,
    keywordId: string
  ): Promise<SemanticKeywordInsights> {
    const projectId = requiredProjectId(context.tenant);
    const payload = await this.request(
      "GET",
      new URL(
        `/internal/v1/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(keywordId)}/insights`,
        this.config.services.seoData
      ),
      context
    );
    return semanticKeywordInsights(responseData(payload), keywordId);
  }

  public async keywordAiAnswers(
    context: InternalContext,
    keywordId: string
  ): Promise<readonly SemanticAiAnswerDetail[]> {
    const projectId = requiredProjectId(context.tenant);
    const payload = await this.request(
      "GET",
      new URL(
        `/internal/v1/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(keywordId)}/ai-answers`,
        this.config.services.seoData
      ),
      context
    );
    return semanticAiAnswerDetails(responseData(payload), keywordId);
  }

  public async keywordAiAnswerHistory(
    context: InternalContext,
    keywordId: string,
    query: AiAnswerHistoryQuery
  ): Promise<AiAnswerHistoryPage> {
    const projectId = requiredProjectId(context.tenant);
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(keywordId)}/ai-answers/history`,
      this.config.services.seoData
    );
    url.searchParams.set("limit", String(query.limit));
    if (query.cursor) url.searchParams.set("cursor", query.cursor);
    const payload = await this.request("GET", url, context);
    return semanticAiAnswerHistoryCollection(
      responseData(payload),
      context.tenant.workspaceId,
      projectId,
      keywordId,
      query
    );
  }

  public async deleteKeywordFrequencyContext(
    context: InternalContext,
    keywordId: string,
    type: SemanticFrequencyType,
    regionCode: string,
    device: SemanticFrequencyDevice
  ): Promise<void> {
    const projectId = requiredProjectId(context.tenant);
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(keywordId)}/frequencies/${encodeURIComponent(type)}/${encodeURIComponent(device)}`,
      this.config.services.seoData
    );
    url.searchParams.set("regionCode", regionCode);
    await this.request(
      "DELETE",
      url,
      context
    );
  }

  public async frequencyOperationResult(
    context: InternalContext,
    jobId: string,
    keywordIds: readonly string[]
  ): Promise<InternalFrequencyOperationResult> {
    const scope = trackingScope(context);
    const body: InternalFrequencyOperationResultInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      jobId,
      keywordIds
    };
    const payload = await this.request(
      "POST",
      new URL(
        `/internal/v1/projects/${encodeURIComponent(
          scope.projectId
        )}/operation-results/frequency/${encodeURIComponent(jobId)}`,
        this.config.services.seoData
      ),
      context,
      body
    );
    return scopedInternalFrequencyOperationResult(
      responseData(payload),
      scope.workspaceId,
      scope.projectId,
      jobId,
      keywordIds
    );
  }

  public async aiAnswerOperationResult(
    context: InternalContext,
    jobId: string,
    keywordIds: readonly string[]
  ): Promise<InternalAiAnswerOperationResult> {
    const scope = trackingScope(context);
    const body: InternalAiAnswerOperationResultInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      jobId,
      keywordIds
    };
    const payload = await this.request(
      "POST",
      new URL(
        `/internal/v1/projects/${encodeURIComponent(
          scope.projectId
        )}/operation-results/ai-answer/${encodeURIComponent(jobId)}`,
        this.config.services.seoData
      ),
      context,
      body
    );
    return scopedInternalAiAnswerOperationResult(
      responseData(payload),
      scope.workspaceId,
      scope.projectId,
      jobId,
      keywordIds
    );
  }

  public async rankOperationResult(
    context: InternalContext,
    jobId: string,
    limit: number,
    cursor?: string
  ): Promise<InternalRankOperationResult> {
    const scope = trackingScope(context);
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(
        scope.projectId
      )}/operation-results/rank/${encodeURIComponent(jobId)}`,
      this.config.services.seoData
    );
    url.searchParams.set("limit", String(limit));
    if (cursor !== undefined) url.searchParams.set("cursor", cursor);
    const payload = await this.request(
      "GET",
      url,
      context
    );
    return scopedInternalRankOperationResult(
      responseData(payload),
      scope.workspaceId,
      scope.projectId,
      jobId,
      limit,
      cursor
    );
  }

  public async crawlOperationResult(
    context: InternalContext,
    crawlId: string,
    limit: number,
    cursor?: string
  ): Promise<InternalCrawlOperationResultPage> {
    const scope = trackingScope(context);
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(
        scope.projectId
      )}/operation-results/crawl/${encodeURIComponent(crawlId)}`,
      this.config.services.seoData
    );
    url.searchParams.set("limit", String(limit));
    if (cursor !== undefined) url.searchParams.set("cursor", cursor);
    const payload = await this.request("GET", url, context);
    return scopedInternalCrawlOperationResultPage(
      responseData(payload),
      scope.workspaceId,
      scope.projectId,
      crawlId,
      limit
    );
  }

  public async createKeyword(
    context: InternalContext,
    input: CreateSemanticKeywordInput,
    entitlement: SemanticCapacityEntitlement
  ): Promise<SemanticKeywordListItem> {
    const scope = trackingScope(context);
    const body: InternalCreateSemanticKeywordInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      entitlement,
      duplicatePolicy: input.duplicatePolicy ?? "REJECT_EXISTING"
    };
    const payload = await this.request(
      "POST",
      keywordUrl(context, this.config.services.seoData),
      context,
      body
    );
    return semanticKeywordItem(responseData(payload));
  }

  public async bulkCreateKeywords(
    context: InternalContext,
    input: SemanticKeywordBulkCreateInput,
    entitlement: SemanticCapacityEntitlement
  ): Promise<SemanticKeywordBulkCreateResult> {
    const scope = trackingScope(context);
    const body: InternalSemanticKeywordBulkCreateInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      entitlement
    };
    const payload = await this.request(
      "POST",
      keywordUrl(context, this.config.services.seoData, "bulk-create"),
      context,
      body
    );
    return semanticKeywordBulkCreateResult(responseData(payload), input);
  }

  public async updateKeyword(
    context: InternalContext,
    keywordId: string,
    input: UpdateSemanticKeywordInput,
    version: number
  ): Promise<SemanticKeywordListItem> {
    const scope = trackingScope(context);
    const body: InternalUpdateSemanticKeywordInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    const payload = await this.request(
      "PATCH",
      keywordUrl(context, this.config.services.seoData, keywordId),
      context,
      body
    );
    return semanticKeywordItem(responseData(payload));
  }

  public async deleteKeyword(
    context: InternalContext,
    keywordId: string,
    version: number,
    permanent = false
  ): Promise<void> {
    const scope = trackingScope(context);
    const body: InternalDeleteSemanticKeywordInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version,
      ...(permanent ? { permanent: true } : {})
    };
    await this.request(
      "DELETE",
      keywordUrl(context, this.config.services.seoData, keywordId),
      context,
      body
    );
  }

  public async bulkUpdateKeywords(
    context: InternalContext,
    input: SemanticKeywordBulkInput
  ): Promise<SemanticKeywordBulkResult> {
    const scope = trackingScope(context);
    const body: InternalSemanticKeywordBulkInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      keywordUrl(context, this.config.services.seoData, "bulk"),
      context,
      body
    );
    return semanticKeywordBulkResult(responseData(payload), input);
  }

  public async previewSemanticKeywordCleaning(
    context: InternalContext,
    input: SemanticKeywordCleaningInput
  ): Promise<SemanticKeywordCleaningPreview> {
    const scope = trackingScope(context);
    const body: InternalSemanticKeywordCleaningInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      keywordUrl(context, this.config.services.seoData, "bulk-clean-preview"),
      context,
      body
    );
    return semanticKeywordCleaningPreview(responseData(payload), input);
  }

  public async cleanSemanticKeywords(
    context: InternalContext,
    input: SemanticKeywordCleaningInput
  ): Promise<SemanticKeywordCleaningResult> {
    const scope = trackingScope(context);
    const body: InternalSemanticKeywordCleaningInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      keywordUrl(context, this.config.services.seoData, "bulk-clean"),
      context,
      body
    );
    return semanticKeywordCleaningResult(responseData(payload), input);
  }

  public async listKeywordGroups(
    context: InternalContext
  ): Promise<readonly SemanticKeywordGroup[]> {
    const payload = await this.request(
      "GET",
      keywordGroupUrl(context, this.config.services.seoData),
      context
    );
    return semanticKeywordGroups(responseData(payload));
  }

  public async createKeywordGroup(
    context: InternalContext,
    input: CreateSemanticKeywordGroupInput,
    entitlement: SemanticCapacityEntitlement
  ): Promise<SemanticKeywordGroup> {
    const scope = trackingScope(context);
    const body: InternalCreateSemanticKeywordGroupInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      entitlement
    };
    const payload = await this.request(
      "POST",
      keywordGroupUrl(context, this.config.services.seoData),
      context,
      body
    );
    return semanticKeywordGroup(responseData(payload));
  }

  public async updateKeywordGroup(
    context: InternalContext,
    groupId: string,
    input: UpdateSemanticKeywordGroupInput,
    version: number
  ): Promise<SemanticKeywordGroup> {
    const scope = trackingScope(context);
    const body: InternalUpdateSemanticKeywordGroupInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    const payload = await this.request(
      "PATCH",
      keywordGroupUrl(context, this.config.services.seoData, groupId),
      context,
      body
    );
    return semanticKeywordGroup(responseData(payload));
  }

  public async deleteKeywordGroup(
    context: InternalContext,
    groupId: string,
    version: number,
    deleteKeywords = false
  ): Promise<void> {
    const scope = trackingScope(context);
    const body: InternalDeleteSemanticKeywordGroupInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version,
      deleteKeywords
    };
    await this.request(
      "DELETE",
      keywordGroupUrl(context, this.config.services.seoData, groupId),
      context,
      body
    );
  }

  public async listSemanticClusters(
    context: InternalContext
  ): Promise<readonly SemanticCluster[]> {
    const payload = await this.request(
      "GET",
      semanticClusterUrl(context, this.config.services.seoData),
      context
    );
    return semanticClusters(responseData(payload));
  }

  public async createSemanticCluster(
    context: InternalContext,
    input: CreateSemanticClusterInput
  ): Promise<SemanticCluster> {
    const scope = trackingScope(context);
    const body: InternalCreateSemanticClusterInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      semanticClusterUrl(context, this.config.services.seoData),
      context,
      body
    );
    return semanticCluster(responseData(payload));
  }

  public async updateSemanticCluster(
    context: InternalContext,
    clusterId: string,
    input: UpdateSemanticClusterInput,
    version: number
  ): Promise<SemanticCluster> {
    const scope = trackingScope(context);
    const body: InternalUpdateSemanticClusterInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    const payload = await this.request(
      "PATCH",
      semanticClusterUrl(context, this.config.services.seoData, clusterId),
      context,
      body
    );
    return semanticCluster(responseData(payload));
  }

  public async deleteSemanticCluster(
    context: InternalContext,
    clusterId: string,
    version: number
  ): Promise<void> {
    const scope = trackingScope(context);
    const body: InternalDeleteSemanticClusterInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    await this.request(
      "DELETE",
      semanticClusterUrl(context, this.config.services.seoData, clusterId),
      context,
      body
    );
  }

  public async previewSemanticClusterPageMapping(
    context: InternalContext,
    input: SemanticClusterPageBulkInput
  ): Promise<SemanticClusterPageBulkPreview> {
    const scope = trackingScope(context);
    const body = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      semanticClusterUrl(
        context,
        this.config.services.seoData,
        "page-mapping-preview"
      ),
      context,
      body
    );
    return semanticClusterPageBulkPreview(responseData(payload), input);
  }

  public async bulkUpdateSemanticClusterPageMapping(
    context: InternalContext,
    input: SemanticClusterPageBulkInput
  ): Promise<SemanticClusterPageBulkResult> {
    const scope = trackingScope(context);
    const body = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      semanticClusterUrl(
        context,
        this.config.services.seoData,
        "page-mapping-bulk"
      ),
      context,
      body
    );
    return semanticClusterPageBulkResult(responseData(payload), input);
  }

  public async previewSemanticClusterMerge(
    context: InternalContext,
    input: SemanticClusterMergeInput
  ): Promise<SemanticClusterMergePreview> {
    const scope = trackingScope(context);
    const body: InternalSemanticClusterMergeInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      semanticClusterUrl(context, this.config.services.seoData, "merge-preview"),
      context,
      body
    );
    return semanticClusterMergePreview(responseData(payload), input);
  }

  public async mergeSemanticClusters(
    context: InternalContext,
    input: SemanticClusterMergeInput
  ): Promise<SemanticClusterMergeResult> {
    const scope = trackingScope(context);
    const body: InternalSemanticClusterMergeInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      semanticClusterUrl(context, this.config.services.seoData, "merge"),
      context,
      body
    );
    return semanticClusterMergeResult(responseData(payload), input);
  }

  public async previewSemanticClusterSplit(
    context: InternalContext,
    input: SemanticClusterSplitInput
  ): Promise<SemanticClusterSplitPreview> {
    const scope = trackingScope(context);
    const body: InternalSemanticClusterSplitInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      semanticClusterUrl(context, this.config.services.seoData, "split-preview"),
      context,
      body
    );
    return semanticClusterSplitPreview(responseData(payload), input);
  }

  public async splitSemanticCluster(
    context: InternalContext,
    input: SemanticClusterSplitInput
  ): Promise<SemanticClusterSplitResult> {
    const scope = trackingScope(context);
    const body: InternalSemanticClusterSplitInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      semanticClusterUrl(context, this.config.services.seoData, "split"),
      context,
      body
    );
    return semanticClusterSplitResult(responseData(payload), input);
  }

  public async listSemanticSavedViews(
    context: InternalContext
  ): Promise<readonly SemanticSavedView[]> {
    const payload = await this.request(
      "GET",
      semanticSavedViewUrl(context, this.config.services.seoData),
      context
    );
    return semanticSavedViews(responseData(payload));
  }

  public async listNegativeKeywordPresets(
    context: InternalContext
  ): Promise<readonly SemanticNegativeKeywordPreset[]> {
    const payload = await this.request(
      "GET",
      negativeKeywordPresetUrl(context, this.config.services.seoData),
      context
    );
    return semanticNegativeKeywordPresets(responseData(payload));
  }

  public async createNegativeKeywordPreset(
    context: InternalContext,
    input: CreateSemanticNegativeKeywordPresetInput
  ): Promise<SemanticNegativeKeywordPreset> {
    const scope = trackingScope(context);
    const body: InternalCreateSemanticNegativeKeywordPresetInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      negativeKeywordPresetUrl(context, this.config.services.seoData),
      context,
      body
    );
    return semanticNegativeKeywordPreset(responseData(payload));
  }

  public async updateNegativeKeywordPreset(
    context: InternalContext,
    presetId: string,
    input: UpdateSemanticNegativeKeywordPresetInput,
    version: number
  ): Promise<SemanticNegativeKeywordPreset> {
    const scope = trackingScope(context);
    const body: InternalUpdateSemanticNegativeKeywordPresetInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    const payload = await this.request(
      "PATCH",
      negativeKeywordPresetUrl(context, this.config.services.seoData, presetId),
      context,
      body
    );
    return semanticNegativeKeywordPreset(responseData(payload));
  }

  public async deleteNegativeKeywordPreset(
    context: InternalContext,
    presetId: string,
    version: number
  ): Promise<void> {
    const scope = trackingScope(context);
    const body: InternalDeleteSemanticNegativeKeywordPresetInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    await this.request(
      "DELETE",
      negativeKeywordPresetUrl(context, this.config.services.seoData, presetId),
      context,
      body
    );
  }

  public async previewNegativeKeywords(
    context: InternalContext,
    input: SemanticNegativeKeywordPreviewInput
  ): Promise<SemanticNegativeKeywordPreview> {
    const scope = trackingScope(context);
    const body: InternalSemanticNegativeKeywordPreviewInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      negativeKeywordCommandUrl(context, this.config.services.seoData, "preview"),
      context,
      body
    );
    return semanticNegativeKeywordPreview(responseData(payload));
  }

  public async applyNegativeKeywords(
    context: InternalContext,
    input: ApplySemanticNegativeKeywordsInput
  ): Promise<SemanticNegativeKeywordApplyResult> {
    const scope = trackingScope(context);
    const body: InternalApplySemanticNegativeKeywordsInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      negativeKeywordCommandUrl(context, this.config.services.seoData, "apply"),
      context,
      body
    );
    return semanticNegativeKeywordApplyResult(responseData(payload));
  }

  public async previewSemanticDuplicates(
    context: InternalContext,
    input: SemanticDuplicatePreviewInput
  ): Promise<SemanticDuplicatePreview> {
    const scope = trackingScope(context);
    const body: InternalSemanticDuplicatePreviewInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      semanticDuplicateCommandUrl(
        context,
        this.config.services.seoData,
        "preview"
      ),
      context,
      body
    );
    return semanticDuplicatePreview(responseData(payload));
  }

  public async applySemanticDuplicates(
    context: InternalContext,
    input: ApplySemanticDuplicatesInput
  ): Promise<SemanticDuplicateApplyResult> {
    const scope = trackingScope(context);
    const body: InternalApplySemanticDuplicatesInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      semanticDuplicateCommandUrl(
        context,
        this.config.services.seoData,
        "apply"
      ),
      context,
      body
    );
    return semanticDuplicateApplyResult(responseData(payload));
  }

  public async listSemanticCustomColumns(
    context: InternalContext
  ): Promise<readonly SemanticCustomColumn[]> {
    const payload = await this.request(
      "GET",
      semanticCustomColumnUrl(context, this.config.services.seoData),
      context
    );
    return semanticCustomColumns(responseData(payload));
  }

  public async listSemanticVersions(
    context: InternalContext
  ): Promise<readonly SemanticVersionListItem[]> {
    const payload = await this.request(
      "GET",
      semanticVersionUrl(context, this.config.services.seoData),
      context
    );
    return semanticVersionsResponse(responseData(payload));
  }

  public async getSemanticVersionDetail(
    context: InternalContext,
    versionId: string
  ): Promise<SemanticVersionDetail> {
    const payload = await this.request(
      "GET",
      semanticVersionUrl(
        context,
        this.config.services.seoData,
        versionId
      ),
      context
    );
    return semanticVersionDetailResponse(responseData(payload));
  }

  public async previewSemanticVersionUndo(
    context: InternalContext,
    versionId: string
  ): Promise<SemanticVersionUndoPreview> {
    const payload = await this.request(
      "GET",
      semanticVersionUrl(
        context,
        this.config.services.seoData,
        `${versionId}/undo-preview`
      ),
      context
    );
    return semanticVersionUndoPreviewResponse(responseData(payload));
  }

  public async undoSemanticVersion(
    context: InternalContext,
    versionId: string,
    idempotencyKey: string,
    entitlement: SemanticCapacityEntitlement
  ): Promise<SemanticVersionUndoResult> {
    const scope = trackingScope(context);
    const payload = await this.request(
      "POST",
      semanticVersionUrl(
        context,
        this.config.services.seoData,
        `${versionId}/undo`
      ),
      context,
      {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        actorId: context.actorId,
        idempotencyKey,
        entitlement
      }
    );
    return semanticVersionUndoResultResponse(responseData(payload));
  }

  public async createSemanticCustomColumn(
    context: InternalContext,
    input: CreateSemanticCustomColumnInput
  ): Promise<SemanticCustomColumn> {
    const scope = trackingScope(context);
    const body: InternalCreateSemanticCustomColumnInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      semanticCustomColumnUrl(context, this.config.services.seoData),
      context,
      body
    );
    return semanticCustomColumn(responseData(payload));
  }

  public async updateSemanticCustomColumn(
    context: InternalContext,
    columnId: string,
    input: UpdateSemanticCustomColumnInput,
    version: number
  ): Promise<SemanticCustomColumn> {
    const scope = trackingScope(context);
    const body: InternalUpdateSemanticCustomColumnInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    const payload = await this.request(
      "PATCH",
      semanticCustomColumnUrl(
        context,
        this.config.services.seoData,
        columnId
      ),
      context,
      body
    );
    return semanticCustomColumn(responseData(payload));
  }

  public async deleteSemanticCustomColumn(
    context: InternalContext,
    columnId: string,
    version: number
  ): Promise<void> {
    const scope = trackingScope(context);
    const body: InternalDeleteSemanticCustomColumnInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    await this.request(
      "DELETE",
      semanticCustomColumnUrl(
        context,
        this.config.services.seoData,
        columnId
      ),
      context,
      body
    );
  }

  public async setSemanticKeywordCustomValue(
    context: InternalContext,
    keywordId: string,
    columnId: string,
    input: SetSemanticKeywordCustomValueInput
  ): Promise<SemanticKeywordCustomValue> {
    const scope = trackingScope(context);
    const body: InternalSetSemanticKeywordCustomValueInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
    };
    const payload = await this.request(
      "PUT",
      semanticCustomValueUrl(
        context,
        this.config.services.seoData,
        keywordId,
        columnId
      ),
      context,
      body
    );
    return semanticKeywordCustomValue(responseData(payload));
  }

  public async deleteSemanticKeywordCustomValue(
    context: InternalContext,
    keywordId: string,
    columnId: string,
    version: number
  ): Promise<void> {
    const scope = trackingScope(context);
    const body: InternalDeleteSemanticKeywordCustomValueInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    await this.request(
      "DELETE",
      semanticCustomValueUrl(
        context,
        this.config.services.seoData,
        keywordId,
        columnId
      ),
      context,
      body
    );
  }

  public async createSemanticSavedView(
    context: InternalContext,
    input: CreateSemanticSavedViewInput
  ): Promise<SemanticSavedView> {
    const scope = trackingScope(context);
    const body: InternalCreateSemanticSavedViewInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      canManageShared: canManageSharedViews(context)
    };
    const payload = await this.request(
      "POST",
      semanticSavedViewUrl(context, this.config.services.seoData),
      context,
      body
    );
    return semanticSavedView(responseData(payload));
  }

  public async updateSemanticSavedView(
    context: InternalContext,
    viewId: string,
    input: UpdateSemanticSavedViewInput,
    version: number
  ): Promise<SemanticSavedView> {
    const scope = trackingScope(context);
    const body: InternalUpdateSemanticSavedViewInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version,
      canManageShared: canManageSharedViews(context)
    };
    const payload = await this.request(
      "PATCH",
      semanticSavedViewUrl(
        context,
        this.config.services.seoData,
        viewId
      ),
      context,
      body
    );
    return semanticSavedView(responseData(payload));
  }

  public async deleteSemanticSavedView(
    context: InternalContext,
    viewId: string,
    version: number
  ): Promise<void> {
    const scope = trackingScope(context);
    const body: InternalDeleteSemanticSavedViewInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version,
      canManageShared: canManageSharedViews(context)
    };
    await this.request(
      "DELETE",
      semanticSavedViewUrl(
        context,
        this.config.services.seoData,
        viewId
      ),
      context,
      body
    );
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
    assigned: boolean,
    entitlement: SemanticCapacityEntitlement
  ): Promise<TrackingContextKeywordAssignmentState> {
    const scope = trackingScope(context);
    const body: InternalChangeTrackingContextKeywordInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      contextId,
      keywordId,
      actorId: context.actorId,
      entitlement
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

  public async replaceTrackingContextKeywords(
    context: InternalContext,
    contextId: string,
    input: ReplaceTrackingContextKeywordsInput,
    version: number,
    idempotencyKey: string,
    entitlement: SemanticCapacityEntitlement
  ): Promise<TrackingContextKeywordReplacementResult> {
    const scope = trackingScope(context);
    const body: InternalReplaceTrackingContextKeywordsInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      contextId,
      actorId: context.actorId,
      version,
      idempotencyKey,
      entitlement
    };
    const payload = await this.request(
      "PUT",
      trackingContextUrl(
        context,
        this.config.services.seoData,
        `${contextId}/keywords`
      ),
      context,
      body
    );
    return scopedTrackingContextKeywordReplacement(
      responseData(payload),
      contextId
    );
  }

  public async listProjectPages(
    context: InternalContext,
    query: ProjectPageListQuery
  ): Promise<ProjectPageCollection> {
    const scope = trackingScope(context);
    const url = projectPageUrl(context, this.config.services.seoData);
    url.searchParams.set("limit", String(query.limit));
    if (query.cursor) url.searchParams.set("cursor", query.cursor);
    if (query.search) url.searchParams.set("search", query.search);
    if (query.pathPrefix) url.searchParams.set("pathPrefix", query.pathPrefix);
    if (query.pageType) url.searchParams.set("pageType", query.pageType);
    if (query.indexability) {
      url.searchParams.set("indexability", query.indexability);
    }
    if (query.lifecycleStatus) {
      url.searchParams.set("lifecycleStatus", query.lifecycleStatus);
    }
    const payload = await this.request("GET", url, context);
    return scopedProjectPageCollection(
      responseData(payload),
      scope.workspaceId,
      scope.projectId
    );
  }

  public async listProjectCrawlIssues(
    context: InternalContext,
    pageId?: string
  ): Promise<ProjectCrawlIssueCollection> {
    const scope = trackingScope(context);
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(
        scope.projectId
      )}/crawl-issues`,
      this.config.services.seoData
    );
    if (pageId) url.searchParams.set("pageId", pageId);
    const payload = await this.request(
      "GET",
      url,
      context
    );
    return crawlIssueCollection(responseData(payload));
  }

  public async listProjectCrawlPageChanges(
    context: InternalContext
  ): Promise<ProjectCrawlPageChangeCollection> {
    const scope = trackingScope(context);
    const payload = await this.request(
      "GET",
      new URL(
        `/internal/v1/projects/${encodeURIComponent(
          scope.projectId
        )}/crawl-changes`,
        this.config.services.seoData
      ),
      context
    );
    return crawlPageChangeCollection(responseData(payload));
  }

  public async listProjectCrawlDuplicateGroups(
    context: InternalContext,
    crawlId: string
  ): Promise<ProjectCrawlDuplicateGroupCollection> {
    const scope = trackingScope(context);
    const payload = await this.request(
      "GET",
      new URL(
        `/internal/v1/projects/${encodeURIComponent(
          scope.projectId
        )}/crawls/${encodeURIComponent(crawlId)}/duplicate-groups`,
        this.config.services.seoData
      ),
      context
    );
    return crawlDuplicateGroupCollection(responseData(payload));
  }

  public async listProjectCrawlAbsentPages(
    context: InternalContext,
    crawlId: string
  ): Promise<ProjectCrawlAbsentPageCollection> {
    const scope = trackingScope(context);
    const payload = await this.request(
      "GET",
      new URL(
        `/internal/v1/projects/${encodeURIComponent(
          scope.projectId
        )}/crawls/${encodeURIComponent(crawlId)}/absent-pages`,
        this.config.services.seoData
      ),
      context
    );
    return crawlAbsentPageCollection(responseData(payload), crawlId);
  }

  public async getProjectPage(
    context: InternalContext,
    pageId: string
  ): Promise<ProjectPageSummary> {
    const scope = trackingScope(context);
    const payload = await this.request(
      "GET",
      projectPageUrl(context, this.config.services.seoData, pageId),
      context
    );
    return scopedProjectPage(
      responseData(payload),
      scope.workspaceId,
      scope.projectId,
      pageId
    );
  }

  public async createProjectPage(
    context: InternalContext,
    input: CreateProjectPageInput,
    idempotencyKey: string
  ): Promise<ProjectPageSummary> {
    const scope = trackingScope(context);
    const body: InternalCreateProjectPageInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      idempotencyKey
    };
    const payload = await this.request(
      "POST",
      projectPageUrl(context, this.config.services.seoData),
      context,
      body
    );
    return scopedProjectPage(
      responseData(payload),
      scope.workspaceId,
      scope.projectId
    );
  }

  public async updateProjectPage(
    context: InternalContext,
    pageId: string,
    input: UpdateProjectPageInput,
    version: number
  ): Promise<ProjectPageSummary> {
    const scope = trackingScope(context);
    const body: InternalUpdateProjectPageInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    const payload = await this.request(
      "PATCH",
      projectPageUrl(context, this.config.services.seoData, pageId),
      context,
      body
    );
    return scopedProjectPage(
      responseData(payload),
      scope.workspaceId,
      scope.projectId,
      pageId
    );
  }

  public async changeProjectPageStatus(
    context: InternalContext,
    pageId: string,
    operation: "archive" | "restore",
    version: number
  ): Promise<ProjectPageSummary> {
    const scope = trackingScope(context);
    const body: InternalChangeProjectPageStatusInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
    };
    const payload = await this.request(
      "POST",
      projectPageUrl(
        context,
        this.config.services.seoData,
        `${pageId}/${operation}`
      ),
      context,
      body
    );
    return scopedProjectPage(
      responseData(payload),
      scope.workspaceId,
      scope.projectId,
      pageId
    );
  }

  public async listProjectNotes(
    context: InternalContext
  ): Promise<ProjectNoteCollection> {
    const scope = trackingScope(context);
    const payload = await this.request(
      "GET",
      projectNoteUrl(context, this.config.services.seoData),
      context
    );
    const collection = projectNoteCollection(responseData(payload));
    return {
      notes: collection.notes.map((note) =>
        projectNote(note, scope)
      )
    };
  }

  public async getProjectNote(
    context: InternalContext,
    noteId: string
  ): Promise<ProjectNoteSummary> {
    const scope = trackingScope(context);
    const payload = await this.request(
      "GET",
      projectNoteUrl(context, this.config.services.seoData, noteId),
      context
    );
    return projectNote(responseData(payload), { ...scope, noteId });
  }

  public async createProjectNote(
    context: InternalContext,
    input: CreateProjectNoteInput
  ): Promise<ProjectNoteSummary> {
    const scope = trackingScope(context);
    const body: InternalCreateProjectNoteInput = {
      ...input,
      ...scope,
      actorId: context.actorId
    };
    const payload = await this.request(
      "POST",
      projectNoteUrl(context, this.config.services.seoData),
      context,
      body
    );
    return projectNote(responseData(payload), scope);
  }

  public async updateProjectNote(
    context: InternalContext,
    noteId: string,
    input: UpdateProjectNoteInput,
    version: number
  ): Promise<ProjectNoteSummary> {
    const scope = trackingScope(context);
    const body: InternalUpdateProjectNoteInput = {
      ...input,
      ...scope,
      actorId: context.actorId,
      version
    };
    const payload = await this.request(
      "PATCH",
      projectNoteUrl(context, this.config.services.seoData, noteId),
      context,
      body
    );
    return projectNote(responseData(payload), { ...scope, noteId });
  }

  public async deleteProjectNote(
    context: InternalContext,
    noteId: string,
    version: number
  ): Promise<void> {
    const scope = trackingScope(context);
    const body: InternalDeleteProjectNoteInput = {
      ...scope,
      actorId: context.actorId,
      version
    };
    await this.request(
      "DELETE",
      projectNoteUrl(context, this.config.services.seoData, noteId),
      context,
      body
    );
  }

  public async getPublicProjectNote(
    token: string,
    requestId: string
  ): Promise<PublicProjectNote> {
    const payload = await this.publicRequest(
      new URL(
        `/internal/v1/public/project-notes/${encodeURIComponent(token)}`,
        this.config.services.seoData
      ),
      requestId
    );
    return publicProjectNote(responseData(payload));
  }

  public async adminProjectCounts(
    projectIds: readonly string[],
    actorId: string,
    requestId: string
  ): Promise<readonly AdminProjectSemanticCounts[]> {
    if (
      projectIds.length === 0 ||
      projectIds.length > ADMIN_PROJECT_LIMIT ||
      new Set(projectIds).size !== projectIds.length ||
      projectIds.some((projectId) => !UUID_PATTERN.test(projectId)) ||
      !UUID_PATTERN.test(actorId)
    ) {
      throw new Error("Invalid platform admin project statistics request");
    }
    const payload = await this.platformAdminRequest(
      new URL(
        "/internal/v1/platform-admin/project-statistics",
        this.config.services.seoData
      ),
      actorId,
      requestId,
      { projectIds }
    );
    const data = objectValue(responseData(payload));
    if (!data || !Array.isArray(data.projects)) throw invalidResponse();
    if (data.projects.length !== projectIds.length) throw invalidResponse();
    const expected = new Set(projectIds.map((projectId) => projectId.toLowerCase()));
    const seen = new Set<string>();
    return data.projects.map((value) => {
      const item = objectValue(value);
      if (
        !item ||
        typeof item.projectId !== "string" ||
        !UUID_PATTERN.test(item.projectId) ||
        !expected.has(item.projectId.toLowerCase()) ||
        seen.has(item.projectId.toLowerCase()) ||
        !boundedInteger(item.keywordCount, 10_000_000) ||
        !boundedInteger(item.folderCount, 1_000_000)
      ) {
        throw invalidResponse();
      }
      seen.add(item.projectId.toLowerCase());
      return {
        projectId: item.projectId.toLowerCase(),
        keywordCount: Number(item.keywordCount),
        folderCount: Number(item.folderCount)
      };
    });
  }

  private async platformAdminRequest(
    url: URL,
    actorId: string,
    requestId: string,
    body: unknown
  ): Promise<unknown> {
    const token = this.config.seoDataApiToken;
    if (!token) throw dependencyUnavailable();
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Internal-Token": token,
      "X-Request-Id": requestId,
      "X-Actor-Id": actorId
    });
    const serializedBody = JSON.stringify(body);
    let response: SeoDataTransportResponse;
    try {
      response = this.transport
        ? await this.transport.request({
            method: "POST",
            url,
            headers: Object.fromEntries(headers.entries()),
            body: serializedBody,
            timeoutMs: this.config.dependencyTimeoutMs
          })
        : await fetch(url, {
            method: "POST",
            headers,
            body: serializedBody,
            redirect: "error",
            signal: AbortSignal.timeout(this.config.dependencyTimeoutMs)
          });
    } catch {
      throw dependencyUnavailable();
    }
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw upstreamError(response.status, payload);
    return payload;
  }

  private async publicRequest(url: URL, requestId: string): Promise<unknown> {
    const token = this.config.seoDataApiToken;
    if (!token) throw dependencyUnavailable();
    const headers = new Headers({
      Accept: "application/json",
      "X-Internal-Token": token,
      "X-Request-Id": requestId
    });
    let response: SeoDataTransportResponse;
    try {
      response = this.transport
        ? await this.transport.request({
            method: "GET",
            url,
            headers: Object.fromEntries(headers.entries()),
            timeoutMs: this.config.dependencyTimeoutMs
          })
        : await fetch(url, {
            method: "GET",
            headers,
            redirect: "error",
            signal: AbortSignal.timeout(this.config.dependencyTimeoutMs)
          });
    } catch {
      throw dependencyUnavailable();
    }
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw upstreamError(response.status, payload);
    return payload;
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

    let response: SeoDataTransportResponse;
    const serializedBody =
      body === undefined ? undefined : JSON.stringify(body);
    const timeoutMs =
      method === "GET"
        ? this.config.dependencyTimeoutMs
        : this.config.internalCommandTimeoutMs;
    try {
      response = this.transport
        ? await this.transport.request({
            method,
            url,
            headers: Object.fromEntries(headers.entries()),
            ...(serializedBody === undefined
              ? {}
              : { body: serializedBody }),
            timeoutMs
          })
        : await fetch(url, {
            method,
            headers,
            redirect: "error",
            ...(serializedBody === undefined
              ? {}
              : { body: serializedBody }),
            signal: AbortSignal.timeout(timeoutMs)
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

  const items = data.map(semanticKeywordItem);
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

export function semanticAiAnswerHistoryCollection(
  value: unknown,
  workspaceId: string,
  projectId: string,
  keywordId: string,
  query: AiAnswerHistoryQuery
): AiAnswerHistoryPage {
  const collection = exactRecord(value, [
    "workspaceId",
    "projectId",
    "keywordId",
    "items",
    "page"
  ]);
  if (
    collection.workspaceId !== workspaceId ||
    collection.projectId !== projectId ||
    collection.keywordId !== keywordId
  ) {
    throw invalidResponse();
  }
  const data = semanticAiAnswerHistoryItems(
    collection.items,
    keywordId,
    query.limit
  );
  const page = exactRecord(collection.page, ["hasNext", "nextCursor"]);
  if (typeof page.hasNext !== "boolean") throw invalidResponse();
  if (page.hasNext) {
    if (
      data.length !== query.limit ||
      typeof page.nextCursor !== "string" ||
      page.nextCursor.length < 1 ||
      page.nextCursor.length > 4_096 ||
      !/^[A-Za-z0-9_-]+$/u.test(page.nextCursor) ||
      page.nextCursor === query.cursor
    ) {
      throw invalidResponse();
    }
    return { data, page: { hasNext: true, nextCursor: page.nextCursor } };
  }
  if (page.nextCursor !== undefined) throw invalidResponse();
  return { data, page: { hasNext: false } };
}

function semanticAiAnswerHistoryItems(
  value: unknown,
  keywordId: string,
  maximum: number
): readonly SemanticAiAnswerHistoryItem[] {
  if (!Array.isArray(value) || value.length > maximum) throw invalidResponse();
  const snapshotIds = new Set<string>();
  let previous: SemanticAiAnswerHistoryItem | undefined;
  return value.map((candidate) => {
    const item = exactRecord(candidate, [
      "snapshotId",
      "keywordId",
      "searchEngine",
      "regionCode",
      "device",
      "answerPresent",
      "siteFound",
      "position",
      "previousPosition",
      "rankingUrl",
      "brandFound",
      "provider",
      "observedAt"
    ]);
    if (
      typeof item.snapshotId !== "string" ||
      !UUID_PATTERN.test(item.snapshotId) ||
      snapshotIds.has(item.snapshotId) ||
      item.keywordId !== keywordId ||
      !["YANDEX", "GOOGLE"].includes(String(item.searchEngine)) ||
      !requiredString(item.regionCode) ||
      !["DESKTOP", "MOBILE"].includes(String(item.device)) ||
      typeof item.answerPresent !== "boolean" ||
      typeof item.siteFound !== "boolean" ||
      !validOptionalPositivePosition(item.position, 100_000) ||
      !validOptionalPositivePosition(item.previousPosition, 100_000) ||
      (item.rankingUrl !== undefined && !validHttpUrl(item.rankingUrl)) ||
      typeof item.brandFound !== "boolean" ||
      item.provider !== "ARSENKIN" ||
      !validDate(item.observedAt) ||
      (!item.answerPresent && (item.siteFound || item.brandFound)) ||
      (item.siteFound !==
        (item.position !== undefined && item.rankingUrl !== undefined))
    ) {
      throw invalidResponse();
    }
    const result: SemanticAiAnswerHistoryItem = {
      snapshotId: item.snapshotId,
      keywordId,
      searchEngine: item.searchEngine as SemanticAiAnswerHistoryItem["searchEngine"],
      regionCode: item.regionCode,
      device: item.device as SemanticAiAnswerHistoryItem["device"],
      answerPresent: item.answerPresent,
      siteFound: item.siteFound,
      ...(typeof item.position === "number" ? { position: item.position } : {}),
      ...(typeof item.previousPosition === "number"
        ? { previousPosition: item.previousPosition }
        : {}),
      ...(typeof item.rankingUrl === "string" ? { rankingUrl: item.rankingUrl } : {}),
      brandFound: item.brandFound,
      provider: "ARSENKIN",
      observedAt: item.observedAt
    };
    if (previous) {
      const time = Date.parse(result.observedAt);
      const previousTime = Date.parse(previous.observedAt);
      if (
        time > previousTime ||
        (time === previousTime && result.snapshotId >= previous.snapshotId)
      ) {
        throw invalidResponse();
      }
    }
    snapshotIds.add(result.snapshotId);
    previous = result;
    return result;
  });
}

function semanticAiAnswerDetails(
  value: unknown,
  keywordId: string
): readonly SemanticAiAnswerDetail[] {
  if (!Array.isArray(value) || value.length > 2) throw invalidResponse();
  const engines = new Set<string>();
  return value.map((candidate) => {
    const item = objectValue(candidate);
    if (
      !item ||
      item.keywordId !== keywordId ||
      !requiredString(item.snapshotId) ||
      !["YANDEX", "GOOGLE"].includes(String(item.searchEngine)) ||
      engines.has(String(item.searchEngine)) ||
      !requiredString(item.regionCode) ||
      !["DESKTOP", "MOBILE"].includes(String(item.device)) ||
      typeof item.answerPresent !== "boolean" ||
      typeof item.siteFound !== "boolean" ||
      (item.position !== undefined &&
        (!Number.isSafeInteger(item.position) || Number(item.position) < 1 || Number(item.position) > 100_000)) ||
      (item.previousPosition !== undefined &&
        (!Number.isSafeInteger(item.previousPosition) || Number(item.previousPosition) < 1 || Number(item.previousPosition) > 100_000)) ||
      (item.rankingUrl !== undefined && !validHttpUrl(item.rankingUrl)) ||
      typeof item.brandFound !== "boolean" ||
      (item.answerMarkdown !== undefined &&
        (typeof item.answerMarkdown !== "string" || item.answerMarkdown.length > 300_000)) ||
      !Array.isArray(item.sources) ||
      item.sources.length > 100 ||
      item.provider !== "ARSENKIN" ||
      !requiredString(item.host) ||
      !requiredString(item.jobId) ||
      !validDate(item.observedAt)
    ) throw invalidResponse();
    engines.add(String(item.searchEngine));
    const positions = new Set<number>();
    const sources = item.sources.map((candidate) => {
      const source = objectValue(candidate);
      if (
        !source ||
        !Number.isSafeInteger(source.position) ||
        Number(source.position) < 1 ||
        Number(source.position) > 100 ||
        positions.has(Number(source.position)) ||
        (source.providerId !== undefined &&
          (!Number.isSafeInteger(source.providerId) || Number(source.providerId) < 0)) ||
        !validHttpUrl(source.url) ||
        (source.title !== undefined &&
          (typeof source.title !== "string" || source.title.length > 4_000)) ||
        (source.description !== undefined &&
          (typeof source.description !== "string" || source.description.length > 12_000)) ||
        typeof source.belongsToProject !== "boolean"
      ) throw invalidResponse();
      positions.add(Number(source.position));
      return {
        position: Number(source.position),
        ...(typeof source.providerId === "number" ? { providerId: source.providerId } : {}),
        url: source.url as string,
        ...(typeof source.title === "string" ? { title: source.title } : {}),
        ...(typeof source.description === "string" ? { description: source.description } : {}),
        belongsToProject: source.belongsToProject
      };
    });
    return {
      snapshotId: item.snapshotId as string,
      keywordId,
      searchEngine: item.searchEngine as SemanticAiAnswerDetail["searchEngine"],
      regionCode: item.regionCode as string,
      device: item.device as SemanticAiAnswerDetail["device"],
      answerPresent: item.answerPresent,
      siteFound: item.siteFound,
      ...(typeof item.position === "number" ? { position: item.position } : {}),
      ...(typeof item.previousPosition === "number"
        ? { previousPosition: item.previousPosition }
        : {}),
      ...(typeof item.rankingUrl === "string" ? { rankingUrl: item.rankingUrl } : {}),
      brandFound: item.brandFound,
      ...(typeof item.answerMarkdown === "string" ? { answerMarkdown: item.answerMarkdown } : {}),
      sources,
      provider: "ARSENKIN" as const,
      host: item.host as string,
      jobId: item.jobId as string,
      observedAt: item.observedAt as string
    };
  });
}

export function semanticKeywordInsights(
  value: unknown,
  keywordId: string
): SemanticKeywordInsights {
  const input = objectValue(value);
  const positionHistory = input?.positionHistory ?? [];
  const competitorSnapshots = input?.competitorSnapshots ?? [];
  const aiPositionHistory = input?.aiPositionHistory ?? [];
  const aiCompetitorSnapshots = input?.aiCompetitorSnapshots ?? [];
  if (
    !input ||
    input.keywordId !== keywordId ||
    !Array.isArray(input.frequencies) ||
    input.frequencies.length > 100 ||
    !Array.isArray(input.positions) ||
    input.positions.length > 50 ||
    (input.note !== undefined &&
      (typeof input.note !== "string" || input.note.length > 4_000)) ||
    !Array.isArray(positionHistory) ||
    positionHistory.length > 240 ||
    !Array.isArray(competitorSnapshots) ||
    competitorSnapshots.length > 2 ||
    !Array.isArray(aiPositionHistory) ||
    aiPositionHistory.length > 240 ||
    !Array.isArray(aiCompetitorSnapshots) ||
    aiCompetitorSnapshots.length > 2
  ) {
    throw invalidResponse();
  }
  return {
    keywordId,
    ...(typeof input.note === "string" ? { note: input.note } : {}),
    frequencies: input.frequencies.map((value) => {
      const item = objectValue(value);
      if (
        !item ||
        !["BASE", "EXACT", "FIXED"].includes(String(item.type)) ||
        !requiredString(item.regionCode) ||
        !["ALL", "DESKTOP", "MOBILE", "PHONE_ONLY", "TABLET_ONLY"].includes(String(item.device)) ||
        (item.period !== undefined &&
          (typeof item.period !== "string" || !/^[0-9A-Za-z._:-]{1,32}$/u.test(item.period))) ||
        (item.value !== undefined &&
          (typeof item.value !== "string" || !/^(?:0|[1-9]\d{0,18})$/u.test(item.value))) ||
        !requiredString(item.provider) ||
        !["BYOK", "PLATFORM", "IMPORT", "MANUAL"].includes(String(item.sourceMode)) ||
        !requiredString(item.jobId) ||
        !Array.isArray(item.qualityFlags) ||
        item.qualityFlags.length > 4 ||
        item.qualityFlags.some((flag) =>
          !["CONTEXT_INCOMPLETE", "STALE", "PARTIAL", "ESTIMATED"].includes(String(flag))
        ) ||
        new Set(item.qualityFlags).size !== item.qualityFlags.length ||
        !validDate(item.observedAt)
      ) throw invalidResponse();
      return {
        type: item.type as "BASE" | "EXACT" | "FIXED",
        regionCode: item.regionCode,
        device: item.device as "ALL" | "DESKTOP" | "MOBILE" | "PHONE_ONLY" | "TABLET_ONLY",
        ...(typeof item.period === "string" ? { period: item.period } : {}),
        ...(typeof item.value === "string" ? { value: item.value } : {}),
        provider: item.provider,
        sourceMode: item.sourceMode as "BYOK" | "PLATFORM" | "IMPORT" | "MANUAL",
        jobId: item.jobId,
        qualityFlags: item.qualityFlags as Array<"CONTEXT_INCOMPLETE" | "STALE" | "PARTIAL" | "ESTIMATED">,
        observedAt: item.observedAt
      };
    }),
    positions: input.positions.map((value) => {
      const item = objectValue(value);
      if (
        !item ||
        !requiredString(item.trackingContextId) ||
        !requiredString(item.contextName) ||
        !["GOOGLE", "YANDEX"].includes(String(item.searchEngine)) ||
        !["DESKTOP", "MOBILE"].includes(String(item.device)) ||
        !requiredString(item.regionCode) ||
        typeof item.found !== "boolean" ||
        (item.position !== undefined && (!Number.isSafeInteger(item.position) || Number(item.position) < 1)) ||
        (item.previousPosition !== undefined && (!Number.isSafeInteger(item.previousPosition) || Number(item.previousPosition) < 1)) ||
        (item.rankingUrl !== undefined && typeof item.rankingUrl !== "string") ||
        !validDate(item.observedAt)
      ) throw invalidResponse();
      return {
        trackingContextId: item.trackingContextId,
        contextName: item.contextName,
        searchEngine: item.searchEngine as "GOOGLE" | "YANDEX",
        device: item.device as "DESKTOP" | "MOBILE",
        regionCode: item.regionCode,
        found: item.found,
        ...(typeof item.position === "number" ? { position: item.position } : {}),
        ...(typeof item.previousPosition === "number"
          ? { previousPosition: item.previousPosition }
          : {}),
        ...(typeof item.rankingUrl === "string" ? { rankingUrl: item.rankingUrl } : {}),
        observedAt: item.observedAt
      };
    }),
    positionHistory: positionHistory.map((value) => {
      const item = objectValue(value);
      if (
        !item ||
        !requiredString(item.snapshotId) ||
        !requiredString(item.trackingContextId) ||
        !requiredString(item.contextName) ||
        !["GOOGLE", "YANDEX"].includes(String(item.searchEngine)) ||
        (item.searchSource !== undefined &&
          !["LIVE", "SEARCH_API"].includes(String(item.searchSource))) ||
        !["DESKTOP", "MOBILE"].includes(String(item.device)) ||
        !requiredString(item.regionCode) ||
        (item.regionLabel !== undefined &&
          (typeof item.regionLabel !== "string" ||
            item.regionLabel.length < 1 ||
            item.regionLabel.length > 160)) ||
        (item.countryCode !== undefined &&
          (typeof item.countryCode !== "string" ||
            !/^[A-Z]{2}$/u.test(item.countryCode))) ||
        (item.language !== undefined &&
          (typeof item.language !== "string" ||
            !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(item.language))) ||
        (item.depth !== undefined &&
          (!Number.isSafeInteger(item.depth) ||
            Number(item.depth) < 1 ||
            Number(item.depth) > 1_000)) ||
        !["XMLSTOCK", "ARSENKIN", "KEY_COLLECTOR"].includes(
          String(item.provider)
        ) ||
        typeof item.found !== "boolean" ||
        (item.position !== undefined &&
          (!Number.isSafeInteger(item.position) || Number(item.position) < 1)) ||
        !validDate(item.observedAt)
      ) throw invalidResponse();
      return {
        snapshotId: item.snapshotId,
        trackingContextId: item.trackingContextId,
        contextName: item.contextName,
        searchEngine: item.searchEngine as "GOOGLE" | "YANDEX",
        ...(item.searchSource === "LIVE" || item.searchSource === "SEARCH_API"
          ? { searchSource: item.searchSource }
          : {}),
        device: item.device as "DESKTOP" | "MOBILE",
        regionCode: item.regionCode,
        ...(typeof item.regionLabel === "string"
          ? { regionLabel: item.regionLabel }
          : {}),
        ...(typeof item.countryCode === "string"
          ? { countryCode: item.countryCode }
          : {}),
        ...(typeof item.language === "string"
          ? { language: item.language }
          : {}),
        ...(typeof item.depth === "number" ? { depth: item.depth } : {}),
        provider: item.provider as
          | "XMLSTOCK"
          | "ARSENKIN"
          | "KEY_COLLECTOR",
        found: item.found,
        ...(typeof item.position === "number" ? { position: item.position } : {}),
        observedAt: item.observedAt
      };
    }),
    competitorSnapshots: competitorSnapshots.map((value) => {
      const item = objectValue(value);
      if (
        !item ||
        !requiredString(item.snapshotId) ||
        !requiredString(item.trackingContextId) ||
        !requiredString(item.contextName) ||
        !["GOOGLE", "YANDEX"].includes(String(item.searchEngine)) ||
        (item.searchSource !== undefined &&
          !["LIVE", "SEARCH_API"].includes(String(item.searchSource))) ||
        !["ARSENKIN", "XMLSTOCK"].includes(String(item.provider)) ||
        !validDate(item.observedAt) ||
        !Array.isArray(item.results) ||
        item.results.length < 1 ||
        item.results.length > 10
      ) throw invalidResponse();
      let previousPosition = 0;
      const results = item.results.map((value) => {
        const result = objectValue(value);
        const position = Number(result?.position);
        if (
          !result ||
          !Number.isSafeInteger(result.position) ||
          position < 1 ||
          position > 100 ||
          position <= previousPosition ||
          !validHttpUrl(result.url) ||
          (result.faviconUrl !== undefined &&
            !validHttpUrl(result.faviconUrl)) ||
          (result.title !== undefined &&
            (typeof result.title !== "string" || result.title.length > 2_048)) ||
          (result.snippet !== undefined &&
            (typeof result.snippet !== "string" || result.snippet.length > 8_192))
        ) throw invalidResponse();
        previousPosition = position;
        return {
          position,
          url: result.url,
          ...(typeof result.faviconUrl === "string"
            ? { faviconUrl: result.faviconUrl }
            : {}),
          ...(typeof result.title === "string" ? { title: result.title } : {}),
          ...(typeof result.snippet === "string" ? { snippet: result.snippet } : {})
        };
      });
      return {
        snapshotId: item.snapshotId,
        trackingContextId: item.trackingContextId,
        contextName: item.contextName,
        searchEngine: item.searchEngine as "GOOGLE" | "YANDEX",
        ...(item.searchSource === "LIVE" || item.searchSource === "SEARCH_API"
          ? { searchSource: item.searchSource }
          : {}),
        provider: item.provider as "ARSENKIN" | "XMLSTOCK",
        observedAt: item.observedAt,
        results
      };
    }),
    aiPositionHistory: semanticAiAnswerHistoryItems(
      aiPositionHistory,
      keywordId,
      240
    ),
    aiCompetitorSnapshots: semanticAiAnswerCompetitorSnapshots(
      aiCompetitorSnapshots
    )
  };
}

function semanticAiAnswerCompetitorSnapshots(
  value: unknown
): readonly SemanticAiAnswerCompetitorSnapshot[] {
  if (!Array.isArray(value) || value.length > 2) throw invalidResponse();
  const snapshotIds = new Set<string>();
  const engines = new Set<string>();
  return value.map((candidate) => {
    const item = exactRecord(candidate, [
      "snapshotId",
      "searchEngine",
      "regionCode",
      "device",
      "provider",
      "observedAt",
      "results"
    ]);
    if (
      typeof item.snapshotId !== "string" ||
      !UUID_PATTERN.test(item.snapshotId) ||
      snapshotIds.has(item.snapshotId) ||
      !["YANDEX", "GOOGLE"].includes(String(item.searchEngine)) ||
      engines.has(String(item.searchEngine)) ||
      !requiredString(item.regionCode) ||
      !["DESKTOP", "MOBILE"].includes(String(item.device)) ||
      item.provider !== "ARSENKIN" ||
      !validDate(item.observedAt) ||
      !Array.isArray(item.results) ||
      item.results.length < 1 ||
      item.results.length > 100
    ) {
      throw invalidResponse();
    }
    let previousPosition = 0;
    const results = item.results.map((candidate) => {
      const result = exactRecord(candidate, ["position", "url", "title", "snippet"]);
      const position = Number(result.position);
      if (
        !Number.isSafeInteger(result.position) ||
        position < 1 ||
        position > 100 ||
        position <= previousPosition ||
        !validHttpUrl(result.url) ||
        (result.title !== undefined &&
          (typeof result.title !== "string" || result.title.length > 4_000)) ||
        (result.snippet !== undefined &&
          (typeof result.snippet !== "string" || result.snippet.length > 12_000))
      ) {
        throw invalidResponse();
      }
      previousPosition = position;
      return {
        position,
        url: result.url,
        ...(typeof result.title === "string" ? { title: result.title } : {}),
        ...(typeof result.snippet === "string" ? { snippet: result.snippet } : {})
      };
    });
    snapshotIds.add(item.snapshotId);
    engines.add(String(item.searchEngine));
    return {
      snapshotId: item.snapshotId,
      searchEngine: item.searchEngine as SemanticAiAnswerCompetitorSnapshot["searchEngine"],
      regionCode: item.regionCode,
      device: item.device as SemanticAiAnswerCompetitorSnapshot["device"],
      provider: "ARSENKIN" as const,
      observedAt: item.observedAt,
      results
    };
  });
}

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function projectPositionSummary(value: unknown): ProjectPositionSummary {
  const input = objectValue(value);
  if (!input) throw invalidResponse();
  const keys = Object.keys(input);
  if (
    !keys.includes("positionedKeywordCount") ||
    keys.some(
      (key) => !["positionedKeywordCount", "averagePosition"].includes(key)
    ) ||
    !Number.isSafeInteger(input.positionedKeywordCount) ||
    Number(input.positionedKeywordCount) < 0 ||
    (input.averagePosition !== undefined &&
      (typeof input.averagePosition !== "number" ||
        !Number.isFinite(input.averagePosition) ||
        input.averagePosition < 1 ||
        input.averagePosition > 100)) ||
    (Number(input.positionedKeywordCount) === 0) !==
      (input.averagePosition === undefined)
  ) {
    throw invalidResponse();
  }
  return {
    positionedKeywordCount: Number(input.positionedKeywordCount),
    ...(typeof input.averagePosition === "number"
      ? { averagePosition: input.averagePosition }
      : {})
  };
}

export function semanticKeywordItem(
  value: unknown
): SemanticKeywordListItem {
  const item = objectValue(value);
  if (!item) throw invalidResponse();

  const tags = item.tags;
  const customValues = item.customValues ?? [];
  const frequency = optionalSemanticKeywordListFrequency(item.frequency);
  const frequencies = semanticKeywordListFrequencies(item.frequencies);
  const positions = semanticKeywordListPositions(item.positions);
  const aiAnswers = semanticKeywordListAiAnswers(item.aiAnswers);
  const sourceMode = item.sourceMode;
  if (
    !requiredString(item.id) ||
    !requiredString(item.textOriginal) ||
    !requiredString(item.textNormalized) ||
    !requiredString(item.language) ||
    !Number.isSafeInteger(item.priority) ||
    typeof item.isFavorite !== "boolean" ||
    typeof item.isTracked !== "boolean" ||
    typeof item.showAiAnswerButton !== "boolean" ||
    (item.hasNote !== undefined && typeof item.hasNote !== "boolean") ||
    (item.intent !== undefined &&
      (typeof item.intent !== "string" ||
        !semanticKeywordIntents.some((intent) => intent === item.intent))) ||
    (item.groupId !== undefined && !requiredString(item.groupId)) ||
    (item.groupPath !== undefined && typeof item.groupPath !== "string") ||
    (item.clusterId !== undefined && !requiredString(item.clusterId)) ||
    (item.clusterName !== undefined && typeof item.clusterName !== "string") ||
    (item.targetPageId !== undefined && !requiredString(item.targetPageId)) ||
    (item.targetUrl !== undefined && typeof item.targetUrl !== "string") ||
    !Array.isArray(tags) ||
    !tags.every((tag) => typeof tag === "string") ||
    !Array.isArray(customValues) ||
    typeof item.tagsTruncated !== "boolean" ||
    (item.trashed !== undefined && typeof item.trashed !== "boolean") ||
    (item.createOutcome !== undefined &&
      ![
        "CREATED",
        "RESTORED",
        "LINKED_EXISTING",
        "SKIPPED_EXISTING"
      ].includes(
        String(item.createOutcome)
      )) ||
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
    isFavorite: item.isFavorite,
    isTracked: item.isTracked,
    showAiAnswerButton: item.showAiAnswerButton,
    hasNote: item.hasNote === true,
    ...(typeof item.intent === "string"
      ? {
          intent: item.intent as SemanticKeywordIntent
        }
      : {}),
    ...(typeof item.groupId === "string"
      ? { groupId: item.groupId }
      : {}),
    ...(typeof item.groupPath === "string"
      ? { groupPath: item.groupPath }
      : {}),
    ...(typeof item.clusterId === "string"
      ? { clusterId: item.clusterId }
      : {}),
    ...(typeof item.clusterName === "string"
      ? { clusterName: item.clusterName }
      : {}),
    ...(typeof item.targetUrl === "string"
      ? { targetUrl: item.targetUrl }
      : {}),
    ...(typeof item.targetPageId === "string"
      ? { targetPageId: item.targetPageId }
      : {}),
    tags: tags as string[],
    tagsTruncated: item.tagsTruncated,
    customValues: customValues.map(semanticKeywordCustomValue),
    ...(frequency ? { frequency } : {}),
    ...(frequencies.length > 0 ? { frequencies } : {}),
    ...(positions.length > 0 ? { positions } : {}),
    ...(aiAnswers.length > 0 ? { aiAnswers } : {}),
    sourceMode:
      sourceMode as SemanticKeywordListItem["sourceMode"],
    ...(item.trashed === true ? { trashed: true } : {}),
    ...(typeof item.createOutcome === "string"
      ? {
          createOutcome:
            item.createOutcome as NonNullable<
              SemanticKeywordListItem["createOutcome"]
            >
        }
      : {}),
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    version: item.version as number
  };
}

function optionalSemanticKeywordListFrequency(
  value: unknown
): SemanticKeywordListItem["frequency"] {
  if (value === undefined) return undefined;
  const frequency = exactRecord(value, [
    "value",
    "regionCode",
    "device",
    "provider",
    "observedAt"
  ]);
  if (
    (frequency.value !== undefined &&
      (typeof frequency.value !== "string" || !/^\d+$/u.test(frequency.value))) ||
    !requiredString(frequency.regionCode) ||
    !["ALL", "DESKTOP", "MOBILE"].includes(String(frequency.device)) ||
    !requiredString(frequency.provider) ||
    !validDate(frequency.observedAt)
  ) {
    throw invalidResponse();
  }
  return {
    ...(typeof frequency.value === "string" ? { value: frequency.value } : {}),
    regionCode: frequency.regionCode,
    device: frequency.device as "ALL" | "DESKTOP" | "MOBILE",
    provider: frequency.provider,
    observedAt: frequency.observedAt as string
  };
}

function semanticKeywordListFrequencies(
  value: unknown
): NonNullable<SemanticKeywordListItem["frequencies"]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) throw invalidResponse();
  const seen = new Set<string>();
  return value.map((entry) => {
    const frequency = exactRecord(entry, [
      "type",
      "value",
      "regionCode",
      "device",
      "provider",
      "observedAt"
    ]);
    if (
      !["BASE", "EXACT", "FIXED"].includes(String(frequency.type)) ||
      seen.has(String(frequency.type)) ||
      (frequency.value !== undefined &&
        (typeof frequency.value !== "string" || !/^\d+$/u.test(frequency.value))) ||
      !requiredString(frequency.regionCode) ||
      !["ALL", "DESKTOP", "MOBILE"].includes(String(frequency.device)) ||
      !requiredString(frequency.provider) ||
      !validDate(frequency.observedAt)
    ) {
      throw invalidResponse();
    }
    seen.add(String(frequency.type));
    return {
      type: frequency.type as "BASE" | "EXACT" | "FIXED",
      ...(typeof frequency.value === "string" ? { value: frequency.value } : {}),
      regionCode: frequency.regionCode,
      device: frequency.device as "ALL" | "DESKTOP" | "MOBILE",
      provider: frequency.provider,
      observedAt: frequency.observedAt as string
    };
  });
}

function semanticKeywordListPositions(
  value: unknown
): NonNullable<SemanticKeywordListItem["positions"]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 2) throw invalidResponse();
  const positions = value.map((entry) => {
    const position = exactRecord(entry, [
      "searchEngine",
      "found",
      "position",
      "previousPosition",
      "rankingUrl",
      "siteResults",
      "observedAt"
    ]);
    const siteResults = semanticKeywordListSiteResults(position.siteResults);
    if (
      !["GOOGLE", "YANDEX"].includes(String(position.searchEngine)) ||
      typeof position.found !== "boolean" ||
      !validOptionalPositivePosition(position.position) ||
      !validOptionalPositivePosition(position.previousPosition) ||
      (position.rankingUrl !== undefined && typeof position.rankingUrl !== "string") ||
      !validDate(position.observedAt) ||
      (!position.found && position.position !== undefined)
    ) {
      throw invalidResponse();
    }
    return {
      searchEngine: position.searchEngine as "GOOGLE" | "YANDEX",
      found: position.found,
      ...(typeof position.position === "number"
        ? { position: position.position }
        : {}),
      ...(typeof position.previousPosition === "number"
        ? { previousPosition: position.previousPosition }
        : {}),
      ...(typeof position.rankingUrl === "string"
        ? { rankingUrl: position.rankingUrl }
        : {}),
      ...(siteResults.length > 0 ? { siteResults } : {}),
      observedAt: position.observedAt as string
    };
  });
  if (new Set(positions.map(({ searchEngine }) => searchEngine)).size !== positions.length) {
    throw invalidResponse();
  }
  return positions;
}

function semanticKeywordListAiAnswers(
  value: unknown
): NonNullable<SemanticKeywordListItem["aiAnswers"]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 2) throw invalidResponse();
  const answers = value.map((entry) => {
    const answer = exactRecord(entry, [
      "searchEngine",
      "answerPresent",
      "siteFound",
      "position",
      "previousPosition",
      "rankingUrl",
      "brandFound",
      "observedAt"
    ]);
    if (
      !["GOOGLE", "YANDEX"].includes(String(answer.searchEngine)) ||
      typeof answer.answerPresent !== "boolean" ||
      typeof answer.siteFound !== "boolean" ||
      !validOptionalPositivePosition(answer.position, 100_000) ||
      !validOptionalPositivePosition(answer.previousPosition, 100_000) ||
      (answer.rankingUrl !== undefined && !validHttpUrl(answer.rankingUrl)) ||
      typeof answer.brandFound !== "boolean" ||
      !validDate(answer.observedAt) ||
      (!answer.answerPresent && answer.siteFound) ||
      (!answer.siteFound &&
        (answer.position !== undefined || answer.rankingUrl !== undefined))
    ) {
      throw invalidResponse();
    }
    return {
      searchEngine: answer.searchEngine as "GOOGLE" | "YANDEX",
      answerPresent: answer.answerPresent,
      siteFound: answer.siteFound,
      ...(typeof answer.position === "number"
        ? { position: answer.position }
        : {}),
      ...(typeof answer.previousPosition === "number"
        ? { previousPosition: answer.previousPosition }
        : {}),
      ...(typeof answer.rankingUrl === "string"
        ? { rankingUrl: answer.rankingUrl }
        : {}),
      brandFound: answer.brandFound,
      observedAt: answer.observedAt as string
    };
  });
  if (new Set(answers.map(({ searchEngine }) => searchEngine)).size !== answers.length) {
    throw invalidResponse();
  }
  return answers;
}

function semanticKeywordListSiteResults(
  value: unknown
): NonNullable<
  NonNullable<SemanticKeywordListItem["positions"]>[number]["siteResults"]
> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw invalidResponse();
  let previousPosition = 0;
  const seenUrls = new Set<string>();
  return value.map((entry) => {
    const result = exactRecord(entry, [
      "position",
      "rankingUrl",
      "faviconUrl",
      "title",
      "snippet"
    ]);
    const position = Number(result.position);
    if (
      !Number.isSafeInteger(result.position) ||
      position < 1 ||
      position > 100 ||
      position <= previousPosition ||
      !validHttpUrl(result.rankingUrl) ||
      (result.faviconUrl !== undefined &&
        !validHttpUrl(result.faviconUrl)) ||
      (result.title !== undefined &&
        (typeof result.title !== "string" ||
          result.title.length < 1 ||
          result.title.length > 2_048)) ||
      (result.snippet !== undefined &&
        (typeof result.snippet !== "string" ||
          result.snippet.length < 1 ||
          result.snippet.length > 8_192)) ||
      seenUrls.has(result.rankingUrl)
    ) {
      throw invalidResponse();
    }
    previousPosition = position;
    seenUrls.add(result.rankingUrl);
    return {
      position,
      rankingUrl: result.rankingUrl,
      ...(typeof result.faviconUrl === "string"
        ? { faviconUrl: result.faviconUrl }
        : {}),
      ...(typeof result.title === "string" ? { title: result.title } : {}),
      ...(typeof result.snippet === "string"
        ? { snippet: result.snippet }
        : {})
    };
  });
}

function validOptionalPositivePosition(value: unknown, maximum = 1_000): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= maximum)
  );
}

function keywordUrl(
  context: InternalContext,
  baseUrl: string,
  keywordId?: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  const base = `/internal/v1/projects/${encodeURIComponent(
    projectId
  )}/keywords`;
  return new URL(
    keywordId ? `${base}/${encodeURIComponent(keywordId)}` : base,
    baseUrl
  );
}

export function semanticKeywordGroups(
  value: unknown
): readonly SemanticKeywordGroup[] {
  if (!Array.isArray(value) || value.length > 2_000) {
    throw invalidResponse();
  }
  const groups = value.map(semanticKeywordGroup);
  if (new Set(groups.map(({ id }) => id)).size !== groups.length) {
    throw invalidResponse();
  }
  const ids = new Set(groups.map(({ id }) => id));
  if (
    groups.some(
      ({ parentId, id }) =>
        parentId !== undefined && (parentId === id || !ids.has(parentId))
    )
  ) {
    throw invalidResponse();
  }
  return groups;
}

export function semanticKeywordBulkResult(
  value: unknown,
  input: SemanticKeywordBulkInput
): SemanticKeywordBulkResult {
  const result = objectValue(value);
  const keys = [
    "selected",
    "changed",
    "skipped",
    "failed",
    "conflicted",
    "updatedItems",
    "conflictedIds",
    "skippedIds",
    "failedIds"
  ];
  if (
    !result ||
    Object.keys(result).some((key) => !keys.includes(key))
  ) {
    throw invalidResponse();
  }
  const counts = [
    result.selected,
    result.changed,
    result.skipped,
    result.failed,
    result.conflicted
  ];
  if (
    counts.some(
      (count) => !Number.isSafeInteger(count) || Number(count) < 0
    ) ||
    result.selected !== input.items.length ||
    Number(result.changed) +
      Number(result.skipped) +
      Number(result.failed) +
      Number(result.conflicted) !==
      Number(result.selected) ||
    !Array.isArray(result.updatedItems) ||
    result.updatedItems.length !== result.changed
  ) {
    throw invalidResponse();
  }
  const updatedItems = result.updatedItems.map(semanticKeywordItem);
  const allowedIds = new Set(input.items.map(({ id }) => id));
  const idLists = [
    result.conflictedIds,
    result.skippedIds,
    result.failedIds
  ];
  if (
    idLists.some(
      (ids) =>
        !Array.isArray(ids) ||
        ids.some((id) => typeof id !== "string" || !allowedIds.has(id))
    ) ||
    updatedItems.some(({ id }) => !allowedIds.has(id))
  ) {
    throw invalidResponse();
  }
  const allIds = [
    ...updatedItems.map(({ id }) => id),
    ...(result.conflictedIds as string[]),
    ...(result.skippedIds as string[]),
    ...(result.failedIds as string[])
  ];
  if (
    allIds.length !== input.items.length ||
    new Set(allIds).size !== allIds.length
  ) {
    throw invalidResponse();
  }
  return {
    selected: result.selected as number,
    changed: result.changed as number,
    skipped: result.skipped as number,
    failed: result.failed as number,
    conflicted: result.conflicted as number,
    updatedItems,
    conflictedIds: result.conflictedIds as string[],
    skippedIds: result.skippedIds as string[],
    failedIds: result.failedIds as string[]
  };
}

export function semanticKeywordBulkCreateResult(
  value: unknown,
  input: SemanticKeywordBulkCreateInput
): SemanticKeywordBulkCreateResult {
  const result = exactRecord(value, [
    "selected",
    "created",
    "restored",
    "linked",
    "skipped",
    "rejected",
    "failed",
    "rows"
  ]);
  if (!Array.isArray(result.rows)) throw invalidResponse();
  const rows = result.rows.map((value) => {
    const row = exactRecord(value, [
      "index",
      "outcome",
      "keywordId",
      "version",
      "trashed",
      "errorCode"
    ]);
    if (
      !Number.isSafeInteger(row.index) ||
      Number(row.index) < 0 ||
      Number(row.index) >= input.items.length ||
      typeof row.outcome !== "string" ||
      !semanticKeywordCreateOutcomes.some(
        (outcome) => outcome === row.outcome
      )
    ) {
      throw invalidResponse();
    }
    const successful = [
      "CREATED",
      "RESTORED",
      "LINKED_EXISTING",
      "SKIPPED_EXISTING"
    ].includes(row.outcome);
    if (
      (successful &&
        (!requiredString(row.keywordId) ||
          !Number.isSafeInteger(row.version) ||
          Number(row.version) < 1 ||
          row.errorCode !== undefined)) ||
      (!successful &&
        (!requiredString(row.errorCode) ||
          row.keywordId !== undefined ||
          row.version !== undefined))
    ) {
      throw invalidResponse();
    }
    if (
      row.trashed !== undefined &&
      (row.trashed !== true || row.outcome !== "SKIPPED_EXISTING")
    ) {
      throw invalidResponse();
    }
    return {
      index: Number(row.index),
      outcome: row.outcome as SemanticKeywordBulkCreateResult["rows"][number]["outcome"],
      ...(typeof row.keywordId === "string"
        ? { keywordId: row.keywordId }
        : {}),
      ...(typeof row.version === "number" ? { version: row.version } : {}),
      ...(row.trashed === true ? { trashed: true } : {}),
      ...(typeof row.errorCode === "string"
        ? { errorCode: row.errorCode }
        : {})
    };
  });
  const counts = {
    selected: result.selected,
    created: result.created,
    restored: result.restored,
    linked: result.linked,
    skipped: result.skipped,
    rejected: result.rejected,
    failed: result.failed
  };
  const count = (outcome: string): number =>
    rows.filter((row) => row.outcome === outcome).length;
  if (
    Object.values(counts).some(
      (entry) => !Number.isSafeInteger(entry) || Number(entry) < 0
    ) ||
    Number(counts.selected) !== input.items.length ||
    rows.length !== input.items.length ||
    new Set(rows.map(({ index }) => index)).size !== rows.length ||
    Number(counts.created) !== count("CREATED") ||
    Number(counts.restored) !== count("RESTORED") ||
    Number(counts.linked) !== count("LINKED_EXISTING") ||
    Number(counts.skipped) !== count("SKIPPED_EXISTING") ||
    Number(counts.rejected) !== count("REJECTED_EXISTING") ||
    Number(counts.failed) !== count("FAILED")
  ) {
    throw invalidResponse();
  }
  return {
    selected: Number(counts.selected),
    created: Number(counts.created),
    restored: Number(counts.restored),
    linked: Number(counts.linked),
    skipped: Number(counts.skipped),
    rejected: Number(counts.rejected),
    failed: Number(counts.failed),
    rows
  };
}

export function semanticKeywordCleaningPreview(
  value: unknown,
  input: SemanticKeywordCleaningInput
): SemanticKeywordCleaningPreview {
  const preview = exactRecord(value, [
    "selected",
    "applicable",
    "unchanged",
    "conflicted",
    "failed",
    "changes"
  ]);
  if (!Array.isArray(preview.changes) || preview.changes.length !== input.items.length) {
    throw invalidResponse();
  }
  const expectedById = new Map(input.items.map((item) => [item.id, item.version]));
  const changes = preview.changes.map((value) => {
    const change = exactRecord(value, [
      "keywordId",
      "state",
      "expectedVersion",
      "currentVersion",
      "beforeText",
      "afterText"
    ]);
    const unavailable = change.state === "UNAVAILABLE";
    if (
      !requiredString(change.keywordId) ||
      typeof change.state !== "string" ||
      !semanticKeywordCleaningStates.some((state) => state === change.state) ||
      !positiveInteger(change.expectedVersion) ||
      expectedById.get(change.keywordId) !== change.expectedVersion ||
      (unavailable
        ? change.currentVersion !== undefined ||
          change.beforeText !== undefined ||
          change.afterText !== undefined
        : !positiveInteger(change.currentVersion) ||
          !requiredString(change.beforeText) ||
          typeof change.afterText !== "string")
    ) {
      throw invalidResponse();
    }
    return change as unknown as SemanticKeywordCleaningPreview["changes"][number];
  });
  const stateCount = (states: readonly string[]) =>
    changes.filter(({ state }) => states.includes(state)).length;
  if (
    new Set(changes.map(({ keywordId }) => keywordId)).size !== changes.length ||
    !bulkCount(preview.selected, changes.length) ||
    !bulkCount(preview.applicable, stateCount(["APPLICABLE"])) ||
    !bulkCount(preview.unchanged, stateCount(["UNCHANGED"])) ||
    !bulkCount(preview.conflicted, stateCount(["CONFLICTED"])) ||
    !bulkCount(
      preview.failed,
      stateCount(["UNAVAILABLE", "DUPLICATE", "INVALID"])
    )
  ) {
    throw invalidResponse();
  }
  return {
    selected: Number(preview.selected),
    applicable: Number(preview.applicable),
    unchanged: Number(preview.unchanged),
    conflicted: Number(preview.conflicted),
    failed: Number(preview.failed),
    changes
  };
}

export function semanticKeywordCleaningResult(
  value: unknown,
  input: SemanticKeywordCleaningInput
): SemanticKeywordCleaningResult {
  const result = exactRecord(value, [
    "selected",
    "changed",
    "unchanged",
    "conflicted",
    "failed",
    "updatedItems",
    "unchangedIds",
    "conflictedIds",
    "failedIds"
  ]);
  const updatedItems = Array.isArray(result.updatedItems)
    ? result.updatedItems.map(semanticKeywordItem)
    : [];
  const unchangedIds = uuidList(result.unchangedIds, input.items.length);
  const conflictedIds = uuidList(result.conflictedIds, input.items.length);
  const failedIds = uuidList(result.failedIds, input.items.length);
  const allowedIds = new Set(input.items.map(({ id }) => id));
  const partitions = [
    ...updatedItems.map(({ id }) => id),
    ...unchangedIds,
    ...conflictedIds,
    ...failedIds
  ];
  if (
    !Array.isArray(result.updatedItems) ||
    partitions.some((id) => !allowedIds.has(id)) ||
    new Set(partitions).size !== partitions.length ||
    partitions.length !== input.items.length ||
    !bulkCount(result.selected, input.items.length) ||
    !bulkCount(result.changed, updatedItems.length) ||
    !bulkCount(result.unchanged, unchangedIds.length) ||
    !bulkCount(result.conflicted, conflictedIds.length) ||
    !bulkCount(result.failed, failedIds.length)
  ) {
    throw invalidResponse();
  }
  return {
    selected: Number(result.selected),
    changed: Number(result.changed),
    unchanged: Number(result.unchanged),
    conflicted: Number(result.conflicted),
    failed: Number(result.failed),
    updatedItems,
    unchangedIds,
    conflictedIds,
    failedIds
  };
}

export function semanticKeywordGroup(value: unknown): SemanticKeywordGroup {
  const group = objectValue(value);
  if (
    !group ||
    !requiredString(group.id) ||
    !requiredString(group.name) ||
    !requiredString(group.path) ||
    (group.parentId !== undefined && !requiredString(group.parentId)) ||
    (group.color !== undefined &&
      (typeof group.color !== "string" ||
        !/^#[0-9a-f]{6}$/iu.test(group.color))) ||
    (group.systemKind !== undefined &&
      !["UNGROUPED", "TRASH"].includes(String(group.systemKind))) ||
    !Number.isSafeInteger(group.position) ||
    Number(group.position) < 0 ||
    !Number.isSafeInteger(group.keywordCount) ||
    Number(group.keywordCount) < 0 ||
    !Number.isSafeInteger(group.version) ||
    Number(group.version) < 1 ||
    !validDate(group.createdAt) ||
    !validDate(group.updatedAt)
  ) {
    throw invalidResponse();
  }
  return {
    id: group.id,
    ...(typeof group.parentId === "string"
      ? { parentId: group.parentId }
      : {}),
    name: group.name,
    path: group.path,
    ...(typeof group.color === "string" ? { color: group.color } : {}),
    position: group.position as number,
    keywordCount: group.keywordCount as number,
    ...(group.systemKind === "UNGROUPED" || group.systemKind === "TRASH"
      ? { systemKind: group.systemKind }
      : {}),
    version: group.version as number,
    createdAt: group.createdAt as string,
    updatedAt: group.updatedAt as string
  };
}

function keywordGroupUrl(
  context: InternalContext,
  baseUrl: string,
  groupId?: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  const base = `/internal/v1/projects/${encodeURIComponent(
    projectId
  )}/keyword-groups`;
  return new URL(
    groupId ? `${base}/${encodeURIComponent(groupId)}` : base,
    baseUrl
  );
}

export function semanticClusters(value: unknown): readonly SemanticCluster[] {
  if (!Array.isArray(value) || value.length > 2_000) {
    throw invalidResponse();
  }
  const clusters = value.map(semanticCluster);
  if (new Set(clusters.map(({ id }) => id)).size !== clusters.length) {
    throw invalidResponse();
  }
  return clusters;
}

export function semanticCluster(value: unknown): SemanticCluster {
  const cluster = exactRecord(value, [
    "id",
    "name",
    "method",
    "keywordCount",
    "isLocked",
    "excludeFromReclustering",
    "primaryPage",
    "pageMappingSource",
    "pageMappingConfidence",
    "pageMappingRationale",
    "pageDiagnostics",
    "version",
    "createdAt",
    "updatedAt"
  ]);
  const primaryPage = cluster.primaryPage === undefined
    ? undefined
    : semanticClusterPrimaryPage(cluster.primaryPage);
  const diagnostics = semanticClusterPageDiagnostics(cluster.pageDiagnostics);
  if (
    !requiredString(cluster.id) ||
    !requiredString(cluster.name) ||
    typeof cluster.method !== "string" ||
    !semanticClusterMethods.some((method) => method === cluster.method) ||
    !Number.isSafeInteger(cluster.keywordCount) ||
    Number(cluster.keywordCount) < 0 ||
    typeof cluster.isLocked !== "boolean" ||
    typeof cluster.excludeFromReclustering !== "boolean" ||
    (cluster.pageMappingSource !== undefined &&
      (typeof cluster.pageMappingSource !== "string" ||
        !semanticClusterPageSources.some(
          (source) => source === cluster.pageMappingSource
        ))) ||
    (cluster.pageMappingConfidence !== undefined &&
      (typeof cluster.pageMappingConfidence !== "number" ||
        !Number.isFinite(cluster.pageMappingConfidence) ||
        cluster.pageMappingConfidence < 0 ||
        cluster.pageMappingConfidence > 1)) ||
    (cluster.pageMappingRationale !== undefined &&
      !requiredString(cluster.pageMappingRationale)) ||
    (primaryPage === undefined &&
      (cluster.pageMappingSource !== undefined ||
        cluster.pageMappingConfidence !== undefined ||
        cluster.pageMappingRationale !== undefined)) ||
    diagnostics.mappedKeywordCount + diagnostics.unmappedKeywordCount !==
      Number(cluster.keywordCount) ||
    !Number.isSafeInteger(cluster.version) ||
    Number(cluster.version) < 1 ||
    !validDate(cluster.createdAt) ||
    !validDate(cluster.updatedAt)
  ) {
    throw invalidResponse();
  }
  return {
    id: cluster.id,
    name: cluster.name,
    method: cluster.method as SemanticCluster["method"],
    keywordCount: cluster.keywordCount as number,
    isLocked: cluster.isLocked as boolean,
    excludeFromReclustering: cluster.excludeFromReclustering as boolean,
    ...(primaryPage ? { primaryPage } : {}),
    ...(cluster.pageMappingSource === undefined
      ? {}
      : {
          pageMappingSource:
            cluster.pageMappingSource as SemanticClusterPageSource
        }),
    ...(cluster.pageMappingConfidence === undefined
      ? {}
      : { pageMappingConfidence: cluster.pageMappingConfidence as number }),
    ...(cluster.pageMappingRationale === undefined
      ? {}
      : { pageMappingRationale: cluster.pageMappingRationale as string }),
    pageDiagnostics: diagnostics,
    version: cluster.version as number,
    createdAt: cluster.createdAt as string,
    updatedAt: cluster.updatedAt as string
  };
}

export function semanticClusterPageBulkPreview(
  value: unknown,
  input: SemanticClusterPageBulkInput
): SemanticClusterPageBulkPreview {
  const preview = exactRecord(value, [
    "selected",
    "applicable",
    "skipped",
    "conflicted",
    "changes"
  ]);
  if (!Array.isArray(preview.changes) || preview.changes.length !== input.items.length) {
    throw invalidResponse();
  }
  const expectedById = new Map(input.items.map((item) => [item.id, item.version]));
  const changes = preview.changes.map((value) => {
    const change = exactRecord(value, [
      "clusterId",
      "state",
      "expectedVersion",
      "currentVersion",
      "currentPrimaryPageId",
      "targetPrimaryPageId"
    ]);
    if (
      !requiredString(change.clusterId) ||
      typeof change.state !== "string" ||
      !semanticClusterPageBulkStates.some((state) => state === change.state) ||
      !Number.isSafeInteger(change.expectedVersion) ||
      expectedById.get(change.clusterId) !== change.expectedVersion ||
      (change.currentVersion !== undefined &&
        (!Number.isSafeInteger(change.currentVersion) || Number(change.currentVersion) < 1)) ||
      (change.currentPrimaryPageId !== undefined && !requiredString(change.currentPrimaryPageId)) ||
      (change.targetPrimaryPageId !== undefined && !requiredString(change.targetPrimaryPageId)) ||
      (input.primaryPageId === null
        ? change.targetPrimaryPageId !== undefined
        : change.targetPrimaryPageId !== input.primaryPageId)
    ) {
      throw invalidResponse();
    }
    return change as unknown as SemanticClusterPageBulkPreview["changes"][number];
  });
  if (
    new Set(changes.map(({ clusterId }) => clusterId)).size !== changes.length ||
    !bulkCount(preview.selected, changes.length) ||
    !bulkCount(
      preview.applicable,
      changes.filter(({ state }) => state === "APPLICABLE").length
    ) ||
    !bulkCount(
      preview.skipped,
      changes.filter(({ state }) => state === "UNCHANGED").length
    ) ||
    !bulkCount(
      preview.conflicted,
      changes.filter(({ state }) =>
        ["CONFLICTED", "UNAVAILABLE"].includes(state)
      ).length
    )
  ) {
    throw invalidResponse();
  }
  return {
    selected: Number(preview.selected),
    applicable: Number(preview.applicable),
    skipped: Number(preview.skipped),
    conflicted: Number(preview.conflicted),
    changes
  };
}

export function semanticClusterPageBulkResult(
  value: unknown,
  input: SemanticClusterPageBulkInput
): SemanticClusterPageBulkResult {
  const result = exactRecord(value, [
    "selected",
    "changed",
    "skipped",
    "conflicted",
    "updatedClusters",
    "skippedIds",
    "conflictedIds"
  ]);
  const updatedClusters = semanticClusters(result.updatedClusters);
  const skippedIds = uuidList(result.skippedIds, input.items.length);
  const conflictedIds = uuidList(result.conflictedIds, input.items.length);
  const inputIds = new Set(input.items.map(({ id }) => id));
  const partitions = [
    ...updatedClusters.map(({ id }) => id),
    ...skippedIds,
    ...conflictedIds
  ];
  if (
    partitions.some((id) => !inputIds.has(id)) ||
    new Set(partitions).size !== partitions.length ||
    !bulkCount(result.selected, input.items.length) ||
    !bulkCount(result.changed, updatedClusters.length) ||
    !bulkCount(result.skipped, skippedIds.length) ||
    !bulkCount(result.conflicted, conflictedIds.length) ||
    partitions.length !== input.items.length
  ) {
    throw invalidResponse();
  }
  return {
    selected: Number(result.selected),
    changed: Number(result.changed),
    skipped: Number(result.skipped),
    conflicted: Number(result.conflicted),
    updatedClusters,
    skippedIds,
    conflictedIds
  };
}

export function semanticClusterMergePreview(
  value: unknown,
  input: SemanticClusterMergeInput
): SemanticClusterMergePreview {
  const preview = exactRecord(value, [
    "readiness",
    "selectedClusterCount",
    "sourceClusterCount",
    "movedKeywordCount",
    "sourcePageConflictCount",
    "lockedClusterCount",
    "conflictedIds",
    "unavailableIds",
    "synchronousKeywordLimit"
  ]);
  const conflictedIds = uuidList(preview.conflictedIds, input.items.length);
  const unavailableIds = uuidList(preview.unavailableIds, input.items.length);
  const inputIds = new Set(input.items.map(({ id }) => id));
  const conflictIds = [...conflictedIds, ...unavailableIds];
  if (
    typeof preview.readiness !== "string" ||
    !semanticClusterMergeReadiness.some((item) => item === preview.readiness) ||
    !bulkCount(preview.selectedClusterCount, input.items.length) ||
    !bulkCount(preview.sourceClusterCount, input.items.length - 1) ||
    !nonNegativeInteger(preview.movedKeywordCount) ||
    !boundedInteger(preview.sourcePageConflictCount, input.items.length - 1) ||
    !boundedInteger(preview.lockedClusterCount, input.items.length) ||
    !positiveInteger(preview.synchronousKeywordLimit) ||
    conflictIds.some((id) => !inputIds.has(id)) ||
    new Set(conflictIds).size !== conflictIds.length ||
    (conflictIds.length > 0
      ? preview.readiness !== "CONFLICTED"
      : Number(preview.movedKeywordCount) > Number(preview.synchronousKeywordLimit)
        ? preview.readiness !== "BACKGROUND_REQUIRED"
        : preview.readiness !== "READY")
  ) {
    throw invalidResponse();
  }
  return {
    readiness: preview.readiness as SemanticClusterMergePreview["readiness"],
    selectedClusterCount: Number(preview.selectedClusterCount),
    sourceClusterCount: Number(preview.sourceClusterCount),
    movedKeywordCount: Number(preview.movedKeywordCount),
    sourcePageConflictCount: Number(preview.sourcePageConflictCount),
    lockedClusterCount: Number(preview.lockedClusterCount),
    conflictedIds,
    unavailableIds,
    synchronousKeywordLimit: Number(preview.synchronousKeywordLimit)
  };
}

export function semanticClusterMergeResult(
  value: unknown,
  input: SemanticClusterMergeInput
): SemanticClusterMergeResult {
  const result = exactRecord(value, [
    "targetCluster",
    "mergedClusterIds",
    "movedKeywordCount"
  ]);
  const targetCluster = semanticCluster(result.targetCluster);
  const mergedClusterIds = uuidList(result.mergedClusterIds, input.items.length - 1);
  const expectedSourceIds = input.items
    .map(({ id }) => id)
    .filter((id) => id !== input.targetClusterId)
    .sort();
  if (
    targetCluster.id !== input.targetClusterId ||
    !nonNegativeInteger(result.movedKeywordCount) ||
    mergedClusterIds.length !== expectedSourceIds.length ||
    [...mergedClusterIds].sort().some((id, index) => id !== expectedSourceIds[index])
  ) {
    throw invalidResponse();
  }
  return {
    targetCluster,
    mergedClusterIds,
    movedKeywordCount: Number(result.movedKeywordCount)
  };
}

export function semanticClusterSplitPreview(
  value: unknown,
  input: SemanticClusterSplitInput
): SemanticClusterSplitPreview {
  const preview = exactRecord(value, [
    "readiness",
    "sourceClusterState",
    "selectedKeywordCount",
    "movableKeywordCount",
    "sourceKeywordCount",
    "sourceWouldBeEmpty",
    "duplicateName",
    "sourceLocked",
    "conflictedKeywordIds",
    "unavailableKeywordIds",
    "synchronousKeywordLimit"
  ]);
  const conflictedKeywordIds = uuidList(
    preview.conflictedKeywordIds,
    input.keywordItems.length
  );
  const unavailableKeywordIds = uuidList(
    preview.unavailableKeywordIds,
    input.keywordItems.length
  );
  const inputIds = new Set(input.keywordItems.map(({ id }) => id));
  const conflictIds = [...conflictedKeywordIds, ...unavailableKeywordIds];
  const hasConflict =
    preview.sourceClusterState !== "READY" ||
    preview.sourceWouldBeEmpty === true ||
    preview.duplicateName === true ||
    conflictIds.length > 0;
  if (
    typeof preview.readiness !== "string" ||
    !semanticClusterSplitReadiness.some((item) => item === preview.readiness) ||
    typeof preview.sourceClusterState !== "string" ||
    !semanticClusterSplitSourceStates.some(
      (item) => item === preview.sourceClusterState
    ) ||
    !bulkCount(preview.selectedKeywordCount, input.keywordItems.length) ||
    !boundedInteger(preview.movableKeywordCount, input.keywordItems.length) ||
    !nonNegativeInteger(preview.sourceKeywordCount) ||
    typeof preview.sourceWouldBeEmpty !== "boolean" ||
    typeof preview.duplicateName !== "boolean" ||
    typeof preview.sourceLocked !== "boolean" ||
    !positiveInteger(preview.synchronousKeywordLimit) ||
    conflictIds.some((id) => !inputIds.has(id)) ||
    new Set(conflictIds).size !== conflictIds.length ||
    (hasConflict
      ? preview.readiness !== "CONFLICTED"
      : input.keywordItems.length > Number(preview.synchronousKeywordLimit)
        ? preview.readiness !== "BACKGROUND_REQUIRED"
        : preview.readiness !== "READY")
  ) {
    throw invalidResponse();
  }
  return {
    readiness: preview.readiness as SemanticClusterSplitPreview["readiness"],
    sourceClusterState:
      preview.sourceClusterState as SemanticClusterSplitPreview["sourceClusterState"],
    selectedKeywordCount: Number(preview.selectedKeywordCount),
    movableKeywordCount: Number(preview.movableKeywordCount),
    sourceKeywordCount: Number(preview.sourceKeywordCount),
    sourceWouldBeEmpty: preview.sourceWouldBeEmpty,
    duplicateName: preview.duplicateName,
    sourceLocked: preview.sourceLocked,
    conflictedKeywordIds,
    unavailableKeywordIds,
    synchronousKeywordLimit: Number(preview.synchronousKeywordLimit)
  };
}

export function semanticClusterSplitResult(
  value: unknown,
  input: SemanticClusterSplitInput
): SemanticClusterSplitResult {
  const result = exactRecord(value, [
    "sourceCluster",
    "createdCluster",
    "movedKeywordCount"
  ]);
  const sourceCluster = semanticCluster(result.sourceCluster);
  const createdCluster = semanticCluster(result.createdCluster);
  if (
    sourceCluster.id !== input.sourceCluster.id ||
    createdCluster.id === sourceCluster.id ||
    createdCluster.name !== input.newClusterName ||
    !bulkCount(result.movedKeywordCount, input.keywordItems.length)
  ) {
    throw invalidResponse();
  }
  return {
    sourceCluster,
    createdCluster,
    movedKeywordCount: Number(result.movedKeywordCount)
  };
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function boundedInteger(value: unknown, maximum: number): boolean {
  return nonNegativeInteger(value) && Number(value) <= maximum;
}

function uuidList(value: unknown, max: number): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((item) => !requiredString(item)) ||
    new Set(value).size !== value.length
  ) {
    throw invalidResponse();
  }
  return value as string[];
}

function bulkCount(value: unknown, expected: number): boolean {
  return Number.isSafeInteger(value) && Number(value) === expected;
}

function semanticClusterPrimaryPage(
  value: unknown
): NonNullable<SemanticCluster["primaryPage"]> {
  const page = exactRecord(value, [
    "id",
    "url",
    "normalizedUrl",
    "pageType",
    "indexability"
  ]);
  if (
    !requiredString(page.id) ||
    !requiredString(page.url) ||
    !requiredString(page.normalizedUrl) ||
    typeof page.pageType !== "string" ||
    !pageTypes.some((item) => item === page.pageType) ||
    typeof page.indexability !== "string" ||
    !pageIndexabilities.some((item) => item === page.indexability)
  ) {
    throw invalidResponse();
  }
  return page as unknown as NonNullable<SemanticCluster["primaryPage"]>;
}

function semanticClusterPageDiagnostics(
  value: unknown
): SemanticCluster["pageDiagnostics"] {
  const diagnostics = exactRecord(value, [
    "mappedKeywordCount",
    "unmappedKeywordCount",
    "competingPageCount",
    "hasCannibalization",
    "hasMissingLanding"
  ]);
  if (
    !nonNegativeInteger(diagnostics.mappedKeywordCount) ||
    !nonNegativeInteger(diagnostics.unmappedKeywordCount) ||
    !nonNegativeInteger(diagnostics.competingPageCount) ||
    typeof diagnostics.hasCannibalization !== "boolean" ||
    typeof diagnostics.hasMissingLanding !== "boolean"
  ) {
    throw invalidResponse();
  }
  return diagnostics as unknown as SemanticCluster["pageDiagnostics"];
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function semanticClusterUrl(
  context: InternalContext,
  baseUrl: string,
  clusterId?: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  const base = `/internal/v1/projects/${encodeURIComponent(projectId)}/clusters`;
  return new URL(
    clusterId ? `${base}/${encodeURIComponent(clusterId)}` : base,
    baseUrl
  );
}

export function semanticCustomColumns(
  value: unknown
): readonly SemanticCustomColumn[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw invalidResponse();
  }
  const columns = value.map(semanticCustomColumn);
  if (new Set(columns.map(({ id }) => id)).size !== columns.length) {
    throw invalidResponse();
  }
  return columns;
}

export function semanticCustomColumn(value: unknown): SemanticCustomColumn {
  const column = exactRecord(value, [
    "id",
    "name",
    "description",
    "type",
    "config",
    "version",
    "createdAt",
    "updatedAt"
  ]);
  if (
    !requiredString(column.id) ||
    !requiredString(column.name) ||
    (column.description !== undefined &&
      typeof column.description !== "string") ||
    typeof column.type !== "string" ||
    !semanticCustomColumnTypes.some((type) => type === column.type) ||
    !Number.isSafeInteger(column.version) ||
    Number(column.version) < 1 ||
    !validDate(column.createdAt) ||
    !validDate(column.updatedAt)
  ) {
    throw invalidResponse();
  }
  return {
    id: column.id,
    name: column.name,
    ...(typeof column.description === "string"
      ? { description: column.description }
      : {}),
    type: column.type as SemanticCustomColumn["type"],
    config: semanticCustomColumnConfig(column.config, column.type),
    version: column.version as number,
    createdAt: column.createdAt as string,
    updatedAt: column.updatedAt as string
  };
}

export function semanticKeywordCustomValue(
  value: unknown
): SemanticKeywordCustomValue {
  const item = exactRecord(value, [
    "columnId",
    "value",
    "version",
    "updatedAt"
  ]);
  if (
    !requiredString(item.columnId) ||
    !validCustomValue(item.value) ||
    !Number.isSafeInteger(item.version) ||
    Number(item.version) < 1 ||
    !validDate(item.updatedAt)
  ) {
    throw invalidResponse();
  }
  return {
    columnId: item.columnId,
    value: item.value,
    version: item.version as number,
    updatedAt: item.updatedAt as string
  };
}

function semanticCustomColumnConfig(
  value: unknown,
  type: unknown
): SemanticCustomColumnConfig {
  const config = exactRecord(value, ["required", "options"]);
  if (typeof config.required !== "boolean") throw invalidResponse();
  const optionType = ["SELECT", "MULTI_SELECT", "STATUS"].includes(
    String(type)
  );
  if (
    optionType !== (config.options !== undefined) ||
    (config.options !== undefined && !Array.isArray(config.options))
  ) {
    throw invalidResponse();
  }
  const options =
    config.options === undefined
      ? undefined
      : config.options.map((value) => {
          const option = exactRecord(value, ["id", "label", "color"]);
          if (
            !requiredString(option.id) ||
            !requiredString(option.label) ||
            (option.color !== undefined &&
              (typeof option.color !== "string" ||
                !/^#[0-9a-f]{6}$/iu.test(option.color)))
          ) {
            throw invalidResponse();
          }
          return {
            id: option.id,
            label: option.label,
            ...(typeof option.color === "string"
              ? { color: option.color }
              : {})
          };
        });
  if (
    options &&
    (options.length < 1 ||
      options.length > 100 ||
      new Set(options.map(({ id }) => id)).size !== options.length)
  ) {
    throw invalidResponse();
  }
  return {
    required: config.required,
    ...(options ? { options } : {})
  };
}

function validCustomValue(
  value: unknown
): value is SemanticKeywordCustomValue["value"] {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= 100 &&
      value.every((item) => typeof item === "string") &&
      new Set(value).size === value.length)
  );
}

function semanticCustomColumnUrl(
  context: InternalContext,
  baseUrl: string,
  columnId?: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  const base = `/internal/v1/projects/${encodeURIComponent(
    projectId
  )}/semantic-custom-columns`;
  return new URL(
    columnId ? `${base}/${encodeURIComponent(columnId)}` : base,
    baseUrl
  );
}

function semanticCustomValueUrl(
  context: InternalContext,
  baseUrl: string,
  keywordId: string,
  columnId: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  return new URL(
    `/internal/v1/projects/${encodeURIComponent(
      projectId
    )}/keywords/${encodeURIComponent(
      keywordId
    )}/custom-values/${encodeURIComponent(columnId)}`,
    baseUrl
  );
}

export function semanticSavedViews(
  value: unknown
): readonly SemanticSavedView[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw invalidResponse();
  }
  const views = value.map(semanticSavedView);
  if (new Set(views.map(({ id }) => id)).size !== views.length) {
    throw invalidResponse();
  }
  return views;
}

export function semanticNegativeKeywordPresets(
  value: unknown
): readonly SemanticNegativeKeywordPreset[] {
  if (!Array.isArray(value) || value.length > 500) throw invalidResponse();
  const presets = value.map(semanticNegativeKeywordPreset);
  if (new Set(presets.map(({ id }) => id)).size !== presets.length) throw invalidResponse();
  return presets;
}

export function semanticNegativeKeywordPreset(
  value: unknown
): SemanticNegativeKeywordPreset {
  const input = objectValue(value);
  const rules = objectValue(input?.rules);
  if (
    !input ||
    !requiredString(input.id) ||
    !requiredString(input.name) ||
    input.name.length > 160 ||
    !rules ||
    !Array.isArray(rules.words) ||
    rules.words.length < 1 ||
    rules.words.length > 500 ||
    !rules.words.every((word) => typeof word === "string" && word.length > 0 && word.length <= 160) ||
    typeof rules.matchMode !== "string" ||
    !semanticNegativeKeywordMatchModes.some((mode) => mode === rules.matchMode) ||
    typeof rules.caseSensitive !== "boolean" ||
    (rules.ignoreWordOrder !== undefined && typeof rules.ignoreWordOrder !== "boolean") ||
    (rules.ignorePunctuation !== undefined && typeof rules.ignorePunctuation !== "boolean") ||
    !Number.isSafeInteger(input.version) ||
    Number(input.version) < 1 ||
    !validDate(input.createdAt) ||
    !validDate(input.updatedAt)
  ) throw invalidResponse();
  return {
    id: input.id,
    name: input.name,
    rules: {
      words: rules.words as string[],
      matchMode: rules.matchMode as SemanticNegativeKeywordPreset["rules"]["matchMode"],
      caseSensitive: rules.caseSensitive,
      ignoreWordOrder: rules.ignoreWordOrder === true,
      ignorePunctuation: rules.ignorePunctuation === true
    },
    version: Number(input.version),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export function semanticNegativeKeywordPreview(
  value: unknown
): SemanticNegativeKeywordPreview {
  const input = objectValue(value);
  if (
    !input ||
    !Number.isSafeInteger(input.scannedCount) || Number(input.scannedCount) < 0 ||
    !Number.isSafeInteger(input.matchedCount) || Number(input.matchedCount) < 0 ||
    !Number.isSafeInteger(input.batchCount) || Number(input.batchCount) < 0 || Number(input.batchCount) > 500 ||
    typeof input.hasMore !== "boolean" ||
    typeof input.matchesTruncated !== "boolean" ||
    typeof input.previewHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.previewHash) ||
    !Number.isSafeInteger(input.page) || Number(input.page) < 1 ||
    ![100, 200].includes(Number(input.pageSize)) ||
    !Number.isSafeInteger(input.pageCount) || Number(input.pageCount) < 1 ||
    !Array.isArray(input.matches)
  ) throw invalidResponse();
  const matchedCount = Number(input.matchedCount);
  const batchCount = Number(input.batchCount);
  const page = Number(input.page);
  const pageSize = Number(input.pageSize) as 100 | 200;
  const pageCount = Number(input.pageCount);
  const expectedPageCount = Math.max(1, Math.ceil(matchedCount / pageSize));
  const expectedPageItems = matchedCount === 0
    ? 0
    : Math.min(pageSize, matchedCount - (page - 1) * pageSize);
  if (
    batchCount > matchedCount ||
    input.hasMore !== (matchedCount > batchCount) ||
    pageCount !== expectedPageCount ||
    page > pageCount ||
    input.matches.length !== expectedPageItems ||
    input.matchesTruncated !== (matchedCount > input.matches.length)
  ) {
    throw invalidResponse();
  }
  const matches = input.matches.map((value) => {
    const item = objectValue(value);
    const keywordText = item?.text;
    if (
      !item ||
      !requiredString(item.keywordId) ||
      typeof keywordText !== "string" ||
      !Number.isSafeInteger(item.version) || Number(item.version) < 1 ||
      !Array.isArray(item.matchedWords) ||
      item.matchedWords.length < 1 ||
      item.matchedWords.length > 500 ||
      !item.matchedWords.every((word) => typeof word === "string" && word.length > 0) ||
      !Array.isArray(item.highlightRanges) ||
      item.highlightRanges.length < 1 ||
      item.highlightRanges.length > 500
    ) throw invalidResponse();
    let previousEnd = -1;
    const highlightRanges = item.highlightRanges.map((value) => {
      const range = objectValue(value);
      if (
        !range ||
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        Number(range.start) < 0 ||
        Number(range.end) <= Number(range.start) ||
        Number(range.end) > keywordText.length ||
        Number(range.start) < previousEnd
      ) {
        throw invalidResponse();
      }
      previousEnd = Number(range.end);
      return { start: Number(range.start), end: Number(range.end) };
    });
    return {
      keywordId: item.keywordId,
      text: keywordText,
      version: Number(item.version),
      matchedWords: item.matchedWords as string[],
      highlightRanges
    };
  });
  if (new Set(matches.map(({ keywordId }) => keywordId)).size !== matches.length) {
    throw invalidResponse();
  }
  return {
    scannedCount: Number(input.scannedCount),
    matchedCount,
    batchCount,
    hasMore: input.hasMore,
    previewHash: input.previewHash,
    matches,
    matchesTruncated: input.matchesTruncated,
    page,
    pageSize,
    pageCount
  };
}

export function semanticNegativeKeywordApplyResult(
  value: unknown
): SemanticNegativeKeywordApplyResult {
  const input = objectValue(value);
  if (
    !input ||
    !Number.isSafeInteger(input.deletedCount) || Number(input.deletedCount) < 0 || Number(input.deletedCount) > 500 ||
    typeof input.hasMore !== "boolean" ||
    !Array.isArray(input.deletedKeywordIds) ||
    input.deletedKeywordIds.length !== Number(input.deletedCount) ||
    input.deletedKeywordIds.some(
      (id) => typeof id !== "string" || !UUID_PATTERN.test(id)
    ) ||
    new Set(input.deletedKeywordIds).size !== input.deletedKeywordIds.length
  ) throw invalidResponse();
  return {
    deletedCount: Number(input.deletedCount),
    deletedKeywordIds: input.deletedKeywordIds as string[],
    hasMore: input.hasMore
  };
}

export function semanticDuplicatePreview(
  value: unknown
): SemanticDuplicatePreview {
  const input = objectValue(value);
  if (
    !input ||
    !boundedInteger(input.scannedCount, 50_000) ||
    !boundedInteger(input.duplicateGroupCount, 50_000) ||
    !boundedInteger(input.duplicateKeywordCount, 50_000) ||
    !boundedInteger(input.deletionCount, 50_000) ||
    typeof input.hasMore !== "boolean" ||
    typeof input.groupsTruncated !== "boolean" ||
    !positiveInteger(input.page) ||
    !positiveInteger(input.pageCount) ||
    Number(input.page) > Number(input.pageCount) ||
    !semanticDuplicatePreviewPageSizes.some(
      (pageSize) => pageSize === input.pageSize
    ) ||
    Number(input.pageCount) !== Math.max(
      1,
      Math.ceil(Number(input.duplicateGroupCount) / Number(input.pageSize))
    ) ||
    typeof input.previewHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.previewHash) ||
    !Array.isArray(input.batchItems) ||
    input.batchItems.length > 500 ||
    !Array.isArray(input.groups) ||
    input.groups.length > Number(input.pageSize)
  ) {
    throw invalidResponse();
  }
  const batchItems = input.batchItems.map((value) => {
    const item = objectValue(value);
    if (
      !item ||
      typeof item.id !== "string" ||
      !UUID_PATTERN.test(item.id) ||
      !positiveInteger(item.version)
    ) {
      throw invalidResponse();
    }
    return { id: item.id, version: Number(item.version) };
  });
  if (
    new Set(batchItems.map(({ id }) => id)).size !== batchItems.length ||
    batchItems.length > Number(input.deletionCount) ||
    input.hasMore !== Number(input.deletionCount) > batchItems.length
  ) {
    throw invalidResponse();
  }
  const groups = input.groups.map(semanticDuplicatePreviewGroup);
  if (
    new Set(groups.map(({ id }) => id)).size !== groups.length ||
    groups.length > Number(input.duplicateGroupCount) ||
    groups.length !== expectedDuplicatePageLength(
      Number(input.duplicateGroupCount),
      Number(input.page),
      Number(input.pageSize)
    ) ||
    input.groupsTruncated !==
      Number(input.duplicateGroupCount) > groups.length
  ) {
    throw invalidResponse();
  }
  return {
    scannedCount: Number(input.scannedCount),
    duplicateGroupCount: Number(input.duplicateGroupCount),
    duplicateKeywordCount: Number(input.duplicateKeywordCount),
    deletionCount: Number(input.deletionCount),
    batchItems,
    hasMore: input.hasMore,
    previewHash: input.previewHash,
    groups,
    groupsTruncated: input.groupsTruncated,
    page: Number(input.page),
    pageSize: input.pageSize as SemanticDuplicatePreview["pageSize"],
    pageCount: Number(input.pageCount)
  };
}

function expectedDuplicatePageLength(
  total: number,
  page: number,
  pageSize: number
): number {
  if (total === 0) return 0;
  return Math.min(pageSize, total - (page - 1) * pageSize);
}

function semanticDuplicatePreviewGroup(
  value: unknown
): SemanticDuplicatePreviewGroup {
  const input = objectValue(value);
  if (
    !input ||
    typeof input.id !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.id) ||
    typeof input.keeperKeywordId !== "string" ||
    !UUID_PATTERN.test(input.keeperKeywordId) ||
    typeof input.itemsTruncated !== "boolean" ||
    !Array.isArray(input.items) ||
    input.items.length < 2 ||
    input.items.length > 501
  ) {
    throw invalidResponse();
  }
  const items = input.items.map(semanticDuplicatePreviewItem);
  if (
    new Set(items.map(({ keywordId }) => keywordId)).size !== items.length ||
    items.filter(({ keep }) => keep).length !== 1 ||
    !items.some(
      ({ keywordId, keep }) => keep && keywordId === input.keeperKeywordId
    )
  ) {
    throw invalidResponse();
  }
  return {
    id: input.id,
    keeperKeywordId: input.keeperKeywordId,
    items,
    itemsTruncated: input.itemsTruncated
  };
}

function semanticDuplicatePreviewItem(
  value: unknown
): SemanticDuplicatePreviewItem {
  const input = objectValue(value);
  if (
    !input ||
    typeof input.keywordId !== "string" ||
    !UUID_PATTERN.test(input.keywordId) ||
    typeof input.text !== "string" ||
    input.text.length > 10_000 ||
    !positiveInteger(input.version) ||
    !Number.isSafeInteger(input.priority) ||
    Number(input.priority) < 0 ||
    Number(input.priority) > 100 ||
    typeof input.keep !== "boolean" ||
    !Array.isArray(input.groupPaths) ||
    input.groupPaths.length > 100 ||
    !input.groupPaths.every(
      (path) => typeof path === "string" && path.length > 0 && path.length <= 2_000
    ) ||
    !validOptionalFrequency(input.baseFrequency) ||
    !validOptionalFrequency(input.exactFrequency) ||
    !validOptionalFrequency(input.fixedFrequency)
  ) {
    throw invalidResponse();
  }
  return {
    keywordId: input.keywordId,
    text: input.text,
    version: Number(input.version),
    groupPaths: input.groupPaths as string[],
    priority: Number(input.priority),
    ...(typeof input.baseFrequency === "string"
      ? { baseFrequency: input.baseFrequency }
      : {}),
    ...(typeof input.exactFrequency === "string"
      ? { exactFrequency: input.exactFrequency }
      : {}),
    ...(typeof input.fixedFrequency === "string"
      ? { fixedFrequency: input.fixedFrequency }
      : {}),
    keep: input.keep
  };
}

function validOptionalFrequency(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "string" && /^\d+$/u.test(value));
}

export function semanticDuplicateApplyResult(
  value: unknown
): SemanticDuplicateApplyResult {
  const input = objectValue(value);
  if (
    !input ||
    !boundedInteger(input.deletedCount, 500) ||
    typeof input.hasMore !== "boolean" ||
    !Array.isArray(input.deletedKeywordIds) ||
    input.deletedKeywordIds.length !== Number(input.deletedCount) ||
    input.deletedKeywordIds.some(
      (id) => typeof id !== "string" || !UUID_PATTERN.test(id)
    ) ||
    new Set(input.deletedKeywordIds).size !== input.deletedKeywordIds.length
  ) {
    throw invalidResponse();
  }
  return {
    deletedCount: Number(input.deletedCount),
    deletedKeywordIds: input.deletedKeywordIds as string[],
    hasMore: input.hasMore
  };
}

export function semanticSavedView(value: unknown): SemanticSavedView {
  const view = exactRecord(value, [
    "id",
    "ownerId",
    "scope",
    "name",
    "config",
    "version",
    "createdAt",
    "updatedAt"
  ]);
  if (
    !requiredString(view.id) ||
    !requiredString(view.ownerId) ||
    !requiredString(view.name) ||
    typeof view.scope !== "string" ||
    !semanticSavedViewScopes.some((scope) => scope === view.scope) ||
    !Number.isSafeInteger(view.version) ||
    Number(view.version) < 1 ||
    !validDate(view.createdAt) ||
    !validDate(view.updatedAt)
  ) {
    throw invalidResponse();
  }
  return {
    id: view.id,
    ownerId: view.ownerId,
    scope: view.scope as SemanticSavedView["scope"],
    name: view.name,
    config: semanticSavedViewConfig(view.config),
    version: view.version as number,
    createdAt: view.createdAt as string,
    updatedAt: view.updatedAt as string
  };
}

function semanticSavedViewConfig(value: unknown): SemanticSavedViewConfig {
  const config = exactRecord(value, [
    "schemaVersion",
    "filters",
    "sort",
    "columns",
    "density",
    "columnWidths",
    "pageSize",
    "groupSidebarWidth",
    "expandedGroupIds",
    "selectedGroupIds",
    "appliedViewId"
  ]);
  const filters = exactRecord(config.filters, [
    "search",
    "tag",
    "intent",
    "groupId",
    "clusterId",
    "isFavorite",
    "isTracked",
    "priorityMin",
    "priorityMax"
  ]);
  const filterKeys = Object.keys(filters);
  if (
    config.schemaVersion !== 1 ||
    typeof config.sort !== "string" ||
    !semanticKeywordSorts.some((sort) => sort === config.sort) ||
    typeof config.density !== "string" ||
    !semanticSavedViewDensities.some(
      (density) => density === config.density
    ) ||
    !Array.isArray(config.columns) ||
    config.columns.length < 1 ||
    config.columns.length > 128 ||
    !config.columns.every(
      (column) =>
        typeof column === "string" &&
        (semanticSystemColumnKeys.some((key) => key === column) ||
          /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            column
          ))
    ) ||
    new Set(config.columns).size !== config.columns.length ||
    !config.columns.includes("query") ||
    (filters.search !== undefined &&
      (typeof filters.search !== "string" ||
        filters.search.length > 200)) ||
    (filters.tag !== undefined &&
      (typeof filters.tag !== "string" || filters.tag.length > 160)) ||
    (filters.intent !== undefined &&
      (typeof filters.intent !== "string" ||
        !semanticKeywordIntents.some(
          (intent) => intent === filters.intent
        ))) ||
    (filters.groupId !== undefined &&
      typeof filters.groupId !== "string") ||
    (filters.clusterId !== undefined &&
      typeof filters.clusterId !== "string") ||
    (filters.isFavorite !== undefined &&
      typeof filters.isFavorite !== "boolean") ||
    (filters.isTracked !== undefined &&
      typeof filters.isTracked !== "boolean") ||
    !validOptionalPriority(filters.priorityMin) ||
    !validOptionalPriority(filters.priorityMax) ||
    (typeof filters.priorityMin === "number" &&
      typeof filters.priorityMax === "number" &&
      filters.priorityMin > filters.priorityMax) ||
    filterKeys.length > 9 ||
    !validSavedViewColumnWidths(config.columnWidths, config.columns) ||
    (config.pageSize !== undefined &&
      !semanticKeywordPageSizes.some((size) => size === config.pageSize)) ||
    (config.groupSidebarWidth !== undefined &&
      (!Number.isSafeInteger(config.groupSidebarWidth) ||
        Number(config.groupSidebarWidth) < semanticSavedViewGroupSidebarWidthMin ||
        Number(config.groupSidebarWidth) > semanticSavedViewGroupSidebarWidthMax)) ||
    !validUuidArray(config.expandedGroupIds, 1_000) ||
    !validUuidArray(config.selectedGroupIds, 100) ||
    (config.appliedViewId !== undefined &&
      (typeof config.appliedViewId !== "string" ||
        !UUID_PATTERN.test(config.appliedViewId)))
  ) {
    throw invalidResponse();
  }
  return {
    schemaVersion: 1,
    filters: filters as SemanticSavedViewConfig["filters"],
    sort: config.sort as SemanticSavedViewConfig["sort"],
    columns: config.columns as SemanticSavedViewConfig["columns"],
    density: config.density as SemanticSavedViewConfig["density"],
    ...(config.columnWidths === undefined
      ? {}
      : {
          columnWidths: config.columnWidths as NonNullable<
            SemanticSavedViewConfig["columnWidths"]
          >
        }),
    ...(config.pageSize === undefined
      ? {}
      : {
          pageSize: config.pageSize as NonNullable<
            SemanticSavedViewConfig["pageSize"]
          >
        }),
    ...(config.groupSidebarWidth === undefined
      ? {}
      : { groupSidebarWidth: Number(config.groupSidebarWidth) }),
    ...(config.expandedGroupIds === undefined
      ? {}
      : { expandedGroupIds: config.expandedGroupIds as readonly string[] }),
    ...(config.selectedGroupIds === undefined
      ? {}
      : { selectedGroupIds: config.selectedGroupIds as readonly string[] }),
    ...(config.appliedViewId === undefined
      ? {}
      : { appliedViewId: config.appliedViewId as string })
  };
}

function validSavedViewColumnWidths(
  value: unknown,
  columns: unknown[]
): boolean {
  if (value === undefined) return true;
  const widths = objectValue(value);
  return Boolean(
    widths &&
    Object.keys(widths).every((key) =>
      columns.includes(key) &&
      Number.isSafeInteger(widths[key]) &&
      Number(widths[key]) >= 56 &&
      Number(widths[key]) <= 1_200
    )
  );
}

function validUuidArray(value: unknown, maximum: number): boolean {
  return value === undefined || (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) => typeof item === "string" && UUID_PATTERN.test(item)) &&
    new Set(value).size === value.length
  );
}

function canManageSharedViews(context: InternalContext): boolean {
  return context.tenant.roleCode === "OWNER" || context.tenant.roleCode === "ADMIN";
}

function validOptionalPriority(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100)
  );
}

function semanticSavedViewUrl(
  context: InternalContext,
  baseUrl: string,
  viewId?: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  const base = `/internal/v1/projects/${encodeURIComponent(
    projectId
  )}/semantic-saved-views`;
  return new URL(
    viewId ? `${base}/${encodeURIComponent(viewId)}` : base,
    baseUrl
  );
}

function negativeKeywordPresetUrl(
  context: InternalContext,
  baseUrl: string,
  presetId?: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  const base = `/internal/v1/projects/${encodeURIComponent(projectId)}/negative-keyword-presets`;
  return new URL(presetId ? `${base}/${encodeURIComponent(presetId)}` : base, baseUrl);
}

function negativeKeywordCommandUrl(
  context: InternalContext,
  baseUrl: string,
  action: "preview" | "apply"
): URL {
  const projectId = requiredProjectId(context.tenant);
  return new URL(
    `/internal/v1/projects/${encodeURIComponent(projectId)}/negative-keywords/${action}`,
    baseUrl
  );
}

function semanticDuplicateCommandUrl(
  context: InternalContext,
  baseUrl: string,
  action: "preview" | "apply"
): URL {
  const projectId = requiredProjectId(context.tenant);
  return new URL(
    `/internal/v1/projects/${encodeURIComponent(projectId)}/semantic-duplicates/${action}`,
    baseUrl
  );
}

function semanticVersionUrl(
  context: InternalContext,
  baseUrl: string,
  suffix?: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  const base = `/internal/v1/projects/${encodeURIComponent(
    projectId
  )}/semantic-versions`;
  return new URL(
    suffix ? `${base}/${encodePathSuffix(suffix)}` : base,
    baseUrl
  );
}

function encodePathSuffix(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
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

function projectNoteUrl(
  context: InternalContext,
  baseUrl: string,
  noteId?: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  const base = `/internal/v1/projects/${encodeURIComponent(projectId)}/notes`;
  return new URL(
    noteId ? `${base}/${encodeURIComponent(noteId)}` : base,
    baseUrl
  );
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

function projectPageUrl(
  context: InternalContext,
  baseUrl: string,
  suffix?: string
): URL {
  const projectId = requiredProjectId(context.tenant);
  const base = `/internal/v1/projects/${encodeURIComponent(
    projectId
  )}/pages`;
  return new URL(
    suffix ? `${base}/${encodePathSuffix(suffix)}` : base,
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
    if (code === "QUOTA_EXCEEDED") {
      return new DomainError({
        statusCode: 409,
        code: "QUOTA_EXCEEDED",
        message: "The current plan capacity has been reached"
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
