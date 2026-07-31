import { Inject, Injectable } from "@nestjs/common";
import {
  semanticKeywordIntents,
  semanticKeywordSourceModes,
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
  semanticSavedViewScopes,
  semanticSystemColumnKeys,
  type ApiCollectionResponse,
  type CreateSemanticKeywordInput,
  type CreateSemanticClusterInput,
  type CreateSemanticKeywordGroupInput,
  type InternalCreateSemanticKeywordInput,
  type InternalCreateSemanticClusterInput,
  type InternalCreateSemanticKeywordGroupInput,
  type InternalDeleteSemanticKeywordInput,
  type InternalDeleteSemanticClusterInput,
  type InternalSemanticClusterMergeInput,
  type InternalSemanticClusterSplitInput,
  type InternalDeleteSemanticKeywordGroupInput,
  type InternalSemanticKeywordBulkInput,
  type InternalCreateSemanticSavedViewInput,
  type InternalCreateSemanticCustomColumnInput,
  type InternalDeleteSemanticSavedViewInput,
  type InternalDeleteSemanticCustomColumnInput,
  type InternalDeleteSemanticKeywordCustomValueInput,
  type InternalSetSemanticKeywordCustomValueInput,
  type InternalUpdateSemanticSavedViewInput,
  type InternalUpdateSemanticCustomColumnInput,
  type InternalUpdateSemanticKeywordInput,
  type InternalUpdateSemanticClusterInput,
  type InternalUpdateSemanticKeywordGroupInput,
  type CreateTrackingContextInput,
  type InternalChangeTrackingContextKeywordInput,
  type InternalChangeTrackingContextStatusInput,
  type InternalChangeProjectPageStatusInput,
  type InternalCreateProjectPageInput,
  type InternalCreateTrackingContextInput,
  type InternalUpdateProjectPageInput,
  type InternalUpdateTrackingContextInput,
  type KeywordListQuery,
  type RankHistoryQuery,
  type CreateProjectPageInput,
  type ProjectPageCollection,
  type ProjectPageListQuery,
  type ProjectPageSummary,
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
  type SemanticKeywordBulkResult,
  type SemanticKeywordGroup,
  type SemanticKeywordListItem,
  type CreateSemanticSavedViewInput,
  type CreateSemanticCustomColumnInput,
  type SemanticCustomColumn,
  type SemanticCustomColumnConfig,
  type SemanticKeywordCustomValue,
  type SemanticSavedView,
  type SemanticSavedViewConfig,
  type SemanticCapacityEntitlement,
  type SemanticVersionListItem,
  type SemanticVersionUndoPreview,
  type SemanticVersionUndoResult,
  type UpdateSemanticSavedViewInput,
  type SetSemanticKeywordCustomValueInput,
  type UpdateSemanticCustomColumnInput,
  type TrackingContextCollection,
  type TrackingContextKeywordAssignmentState,
  type TrackingContextKeywordQuery,
  type TrackingContextSummary,
  type UpdateSemanticKeywordInput,
  type UpdateSemanticClusterInput,
  type UpdateProjectPageInput,
  type UpdateSemanticKeywordGroupInput,
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
import {
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
    if (query.intent) url.searchParams.set("intent", query.intent);
    if (query.groupId) url.searchParams.set("groupId", query.groupId);
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
      entitlement
    };
    const payload = await this.request(
      "POST",
      keywordUrl(context, this.config.services.seoData),
      context,
      body
    );
    return semanticKeywordItem(responseData(payload));
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
    version: number
  ): Promise<void> {
    const scope = trackingScope(context);
    const body: InternalDeleteSemanticKeywordInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
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
    input: CreateSemanticKeywordGroupInput
  ): Promise<SemanticKeywordGroup> {
    const scope = trackingScope(context);
    const body: InternalCreateSemanticKeywordGroupInput = {
      ...input,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId
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
    version: number
  ): Promise<void> {
    const scope = trackingScope(context);
    const body: InternalDeleteSemanticKeywordGroupInput = {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actorId: context.actorId,
      version
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
      actorId: context.actorId
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
      version
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
      version
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

  public async listProjectPages(
    context: InternalContext,
    query: ProjectPageListQuery
  ): Promise<ProjectPageCollection> {
    const scope = trackingScope(context);
    const url = projectPageUrl(context, this.config.services.seoData);
    url.searchParams.set("limit", String(query.limit));
    if (query.cursor) url.searchParams.set("cursor", query.cursor);
    if (query.search) url.searchParams.set("search", query.search);
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
    context: InternalContext
  ): Promise<ProjectCrawlIssueCollection> {
    const scope = trackingScope(context);
    const payload = await this.request(
      "GET",
      new URL(
        `/internal/v1/projects/${encodeURIComponent(
          scope.projectId
        )}/crawl-issues`,
        this.config.services.seoData
      ),
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

export function semanticKeywordItem(
  value: unknown
): SemanticKeywordListItem {
  const item = objectValue(value);
  if (!item) throw invalidResponse();

  const tags = item.tags;
  const customValues = item.customValues ?? [];
  const sourceMode = item.sourceMode;
  if (
    !requiredString(item.id) ||
    !requiredString(item.textOriginal) ||
    !requiredString(item.textNormalized) ||
    !requiredString(item.language) ||
    !Number.isSafeInteger(item.priority) ||
    typeof item.isFavorite !== "boolean" ||
    typeof item.isTracked !== "boolean" ||
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
    sourceMode:
      sourceMode as SemanticKeywordListItem["sourceMode"],
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    version: item.version as number
  };
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
    "density"
  ]);
  const filters = exactRecord(config.filters, [
    "search",
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
    config.columns.length > 108 ||
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
    filterKeys.length > 8
  ) {
    throw invalidResponse();
  }
  return {
    schemaVersion: 1,
    filters: filters as SemanticSavedViewConfig["filters"],
    sort: config.sort as SemanticSavedViewConfig["sort"],
    columns: config.columns as SemanticSavedViewConfig["columns"],
    density: config.density as SemanticSavedViewConfig["density"]
  };
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
