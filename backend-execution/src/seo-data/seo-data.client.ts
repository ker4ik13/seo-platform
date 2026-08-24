import { Inject, Injectable } from "@nestjs/common";
import {
  rankProviderOverflowCount,
  type ApiCollectionResponse,
  type SemanticCompetitorExportKeyword,
  type SemanticCompetitorExportOptions,
  type SemanticCustomColumn,
  type SemanticKeywordGroup,
  type SemanticKeywordListItem,
  type SemanticPositionHistoryExportOptions,
  type SemanticPositionHistoryExportRow,
  type KeywordListQuery,
  type InternalAiAnswerKeywords,
  type InternalResolveAiAnswerKeywordsInput,
  type InternalPersistAiAnswerSnapshotBatchInput,
  type InternalClusteringKeywords,
  type InternalResolveClusteringKeywordsInput,
  type InternalPersistClusteringProposalInput,
  type ClusteringProposalSummary
} from "@seo-platform/contracts";
import type {
  InternalAbortSemanticImportInput,
  InternalAbortSemanticImportResult,
  InternalApplySemanticImportChunkInput,
  InternalBeginSemanticImportInput,
  InternalCompleteSemanticImportInput,
  InternalNormalizeSemanticKeywordsInput,
  InternalNormalizedSemanticKeyword,
  InternalNormalizeSemanticKeywordsResult,
  InternalRankEstimateScope,
  InternalRankEstimateScopeQuery,
  InternalFrequencyKeywords,
  InternalSemanticImportChunkResult,
  InternalSemanticImportReceipt,
  InternalPersistFrequencySnapshotBatchInput,
  SemanticImportResultSummary,
  TrackingContextConfigurationInput,
  InternalResolveFrequencyKeywordInput,
  InternalResolveFrequencyKeywordsInput,
  InternalFrequencyKeyword,
  InternalPersistFrequencySnapshotsInput
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

export class SeoDataClientError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_COMMAND"
      | "CONFLICT"
      | "NOT_FOUND"
      | "QUOTA_EXCEEDED"
      | "UNAVAILABLE",
    public readonly retryable: boolean
  ) {
    super(code);
    this.name = "SeoDataClientError";
  }
}

@Injectable()
export class SeoDataClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async normalizeKeywords(
    input: InternalNormalizeSemanticKeywordsInput
  ): Promise<InternalNormalizeSemanticKeywordsResult> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/normalize`,
      input
    );
    const result = normalizedKeywords(payload);
    if (
      !result ||
      result.rows.length !== input.rows.length ||
      new Set(result.rows.map(({ rowNumber }) => rowNumber)).size !==
        input.rows.length ||
      result.rows.some(
        ({ rowNumber }) =>
          !input.rows.some((row) => row.rowNumber === rowNumber)
      )
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async beginImport(
    input: InternalBeginSemanticImportInput
  ): Promise<InternalSemanticImportReceipt> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/begin`,
      input
    );
    const result = importReceipt(payload);
    if (!result || result.importId !== input.importId) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async applyChunk(
    input: InternalApplySemanticImportChunkInput
  ): Promise<InternalSemanticImportChunkResult> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/chunks`,
      input
    );
    const result = chunkResult(payload);
    if (!result || result.chunkIndex !== input.chunkIndex) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async completeImport(
    input: InternalCompleteSemanticImportInput
  ): Promise<SemanticImportResultSummary> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/complete`,
      input
    );
    const result = importResult(payload);
    if (!result) throw new SeoDataClientError("UNAVAILABLE", true);
    return result;
  }

  public async abortImport(
    input: InternalAbortSemanticImportInput
  ): Promise<InternalAbortSemanticImportResult> {
    const payload = await this.request(
      `/internal/v1/semantic-imports/${encodeURIComponent(input.importId)}/abort`,
      input
    );
    const result = abortImportResult(payload);
    if (!result || result.importId !== input.importId) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async rankEstimateScope(
    input: InternalRankEstimateScopeQuery
  ): Promise<InternalRankEstimateScope> {
    const payload = await this.requestStrictRankScope(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/rank-estimate-scopes`,
      input
    );
    const result = rankEstimateScope(payload);
    if (
      !result ||
      result.workspaceId !== input.workspaceId ||
      result.projectId !== input.projectId ||
      result.trackingContextId !== input.trackingContextId
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return result;
  }

  public async resolveFrequencyKeyword(
    input: InternalResolveFrequencyKeywordInput
  ): Promise<InternalFrequencyKeyword> {
    const payload = await this.request(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/frequencies/resolve`,
      input
    );
    const value = object(payload);
    if (
      !value ||
      value.id !== input.keywordId ||
      typeof value.text !== "string" ||
      value.text.length < 1 ||
      value.text.length > 2_000 ||
      value.version !== input.version
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return { id: value.id, text: value.text, version: value.version };
  }

  public async resolveFrequencyKeywords(
    input: InternalResolveFrequencyKeywordsInput
  ): Promise<InternalFrequencyKeywords> {
    const payload = await this.requestBounded(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/frequencies/resolve-batch`,
      input,
      FREQUENCY_RESOLVE_RESPONSE_MAX_BYTES
    );
    const value = exactObject(payload, ["items"]);
    if (!value || !Array.isArray(value.items) || value.items.length !== input.items.length) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const expected = new Map(input.items.map((item) => [item.id, item.version]));
    const seen = new Set<string>();
    const items = value.items.map((candidate) => {
      const item = exactObject(candidate, ["id", "text", "version"]);
      if (
        !item ||
        typeof item.id !== "string" ||
        !uuid(item.id) ||
        seen.has(item.id) ||
        typeof item.text !== "string" ||
        item.text.length < 1 ||
        item.text.length > 2_000 ||
        !positiveInteger(item.version) ||
        expected.get(item.id) !== item.version
      ) {
        throw new SeoDataClientError("UNAVAILABLE", true);
      }
      seen.add(item.id);
      return {
        id: item.id,
        text: item.text,
        version: Number(item.version)
      };
    });
    return { items };
  }

  public async persistFrequencySnapshots(
    input: InternalPersistFrequencySnapshotsInput
  ): Promise<void> {
    const payload = await this.request(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/frequencies/snapshots`,
      input
    );
    const value = object(payload);
    if (
      !value ||
      !Number.isSafeInteger(value.created) ||
      Number(value.created) < 0 ||
      Number(value.created) > input.snapshots.length
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
  }

  public async persistFrequencySnapshotBatch(
    input: InternalPersistFrequencySnapshotBatchInput
  ): Promise<void> {
    const payload = await this.requestBounded(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/frequencies/snapshots-batch`,
      input,
      FREQUENCY_PERSIST_RESPONSE_MAX_BYTES
    );
    const value = exactObject(payload, ["created"]);
    const maximum = input.items.reduce(
      (count, item) => count + item.snapshots.length,
      0
    );
    if (
      !value ||
      !Number.isSafeInteger(value.created) ||
      Number(value.created) < 0 ||
      Number(value.created) > maximum
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
  }

  public async resolveAiAnswerKeywords(
    input: InternalResolveAiAnswerKeywordsInput
  ): Promise<InternalAiAnswerKeywords> {
    const payload = await this.requestBounded(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/ai-answers/resolve-batch`,
      input,
      AI_ANSWER_RESOLVE_RESPONSE_MAX_BYTES
    );
    const value = exactObject(payload, ["items"]);
    if (!value || !Array.isArray(value.items) || value.items.length !== input.items.length) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const expected = new Map(input.items.map((item) => [item.id, item.version]));
    const seen = new Set<string>();
    const items = value.items.map((candidate) => {
      const item = exactObject(candidate, ["id", "text", "version"]);
      if (
        !item ||
        !uuid(item.id) ||
        seen.has(item.id as string) ||
        typeof item.text !== "string" ||
        item.text.length < 1 ||
        item.text.length > 2_000 ||
        !positiveInteger(item.version) ||
        expected.get(item.id as string) !== item.version
      ) throw new SeoDataClientError("UNAVAILABLE", true);
      seen.add(item.id as string);
      return { id: item.id as string, text: item.text, version: Number(item.version) };
    });
    return { items };
  }

  public async persistAiAnswerSnapshots(
    input: InternalPersistAiAnswerSnapshotBatchInput
  ): Promise<void> {
    const payload = await this.requestBounded(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/ai-answers/snapshots-batch`,
      input,
      AI_ANSWER_PERSIST_RESPONSE_MAX_BYTES
    );
    const value = exactObject(payload, ["created"]);
    if (
      !value ||
      !Number.isSafeInteger(value.created) ||
      Number(value.created) < 0 ||
      Number(value.created) > input.items.length
    ) throw new SeoDataClientError("UNAVAILABLE", true);
  }

  public async resolveClusteringKeywords(
    input: InternalResolveClusteringKeywordsInput
  ): Promise<InternalClusteringKeywords> {
    const payload = await this.requestBounded(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/clustering-proposals/resolve-batch`,
      input,
      CLUSTERING_RESOLVE_RESPONSE_MAX_BYTES
    );
    const value = exactObject(payload, ["items"]);
    if (!value || !Array.isArray(value.items) || value.items.length !== input.items.length) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const expected = new Map(input.items.map((item) => [item.id, item.version]));
    const seen = new Set<string>();
    const items = value.items.map((candidate) => {
      const item = exactObject(candidate, ["id", "text", "version"]);
      if (
        !item ||
        !uuid(item.id) ||
        seen.has(item.id as string) ||
        typeof item.text !== "string" ||
        item.text.length < 1 ||
        item.text.length > 2_000 ||
        !positiveInteger(item.version) ||
        expected.get(item.id as string) !== item.version
      ) throw new SeoDataClientError("UNAVAILABLE", true);
      seen.add(item.id as string);
      return { id: item.id as string, text: item.text, version: Number(item.version) };
    });
    return { items };
  }

  public async persistClusteringProposal(
    input: InternalPersistClusteringProposalInput
  ): Promise<ClusteringProposalSummary> {
    const payload = await this.requestBounded(
      `/internal/v1/projects/${encodeURIComponent(input.projectId)}/clustering-proposals`,
      input,
      CLUSTERING_PERSIST_RESPONSE_MAX_BYTES,
      CLUSTERING_PERSIST_COMMAND_TIMEOUT_MS
    );
    return clusteringProposalSummary(payload, input);
  }

  public async listExportKeywords(
    context: { readonly workspaceId: string; readonly projectId: string; readonly actorId: string },
    query: KeywordListQuery
  ): Promise<ApiCollectionResponse<SemanticKeywordListItem>> {
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(context.projectId)}/semantic-exports/keywords`,
      this.config.services.seoData
    );
    url.searchParams.set("limit", String(query.limit));
    if (query.cursor) url.searchParams.set("cursor", query.cursor);
    if (query.search) url.searchParams.set("search", query.search);
    if (query.tag) url.searchParams.set("tag", query.tag);
    if (query.intent) url.searchParams.set("intent", query.intent);
    if (query.groupId) url.searchParams.set("groupId", query.groupId);
    if (query.groupIds?.length) url.searchParams.set("groupIds", query.groupIds.join(","));
    if (query.clusterId) url.searchParams.set("clusterId", query.clusterId);
    if (query.isFavorite !== undefined) url.searchParams.set("isFavorite", String(query.isFavorite));
    if (query.isTracked !== undefined) url.searchParams.set("isTracked", String(query.isTracked));
    if (query.priorityMin !== undefined) url.searchParams.set("priorityMin", String(query.priorityMin));
    if (query.priorityMax !== undefined) url.searchParams.set("priorityMax", String(query.priorityMax));
    if (query.sort) url.searchParams.set("sort", query.sort);
    const payload = await this.requestGetBounded(url, context, EXPORT_PAGE_RESPONSE_MAX_BYTES);
    const envelope = object(payload);
    if (!envelope || !Array.isArray(envelope.data) || !object(envelope.page)) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const page = envelope.page as Readonly<Record<string, unknown>>;
    if (
      typeof page.hasNext !== "boolean" ||
      (page.nextCursor !== undefined && typeof page.nextCursor !== "string") ||
      envelope.data.length > query.limit
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return {
      data: envelope.data as readonly SemanticKeywordListItem[],
      page: {
        hasNext: page.hasNext,
        ...(typeof page.nextCursor === "string" ? { nextCursor: page.nextCursor } : {}),
        ...(Number.isSafeInteger(page.totalApprox) && Number(page.totalApprox) >= 0
          ? { totalApprox: Number(page.totalApprox) }
          : {})
      },
      meta: { requestId: "internal-semantic-export" }
    };
  }

  public async listExportCompetitors(
    context: { readonly workspaceId: string; readonly projectId: string; readonly actorId: string },
    query: KeywordListQuery,
    options: SemanticCompetitorExportOptions
  ): Promise<ApiCollectionResponse<SemanticCompetitorExportKeyword>> {
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(context.projectId)}/semantic-exports/competitors`,
      this.config.services.seoData
    );
    url.searchParams.set("limit", String(query.limit));
    if (query.cursor) url.searchParams.set("cursor", query.cursor);
    if (query.search) url.searchParams.set("search", query.search);
    if (query.tag) url.searchParams.set("tag", query.tag);
    if (query.intent) url.searchParams.set("intent", query.intent);
    if (query.groupId) url.searchParams.set("groupId", query.groupId);
    if (query.groupIds?.length) url.searchParams.set("groupIds", query.groupIds.join(","));
    if (query.clusterId) url.searchParams.set("clusterId", query.clusterId);
    if (query.isFavorite !== undefined) url.searchParams.set("isFavorite", String(query.isFavorite));
    if (query.isTracked !== undefined) url.searchParams.set("isTracked", String(query.isTracked));
    if (query.priorityMin !== undefined) url.searchParams.set("priorityMin", String(query.priorityMin));
    if (query.priorityMax !== undefined) url.searchParams.set("priorityMax", String(query.priorityMax));
    if (query.sort) url.searchParams.set("sort", query.sort);
    url.searchParams.set("sources", options.sources.join(","));
    const payload = await this.requestGetBounded(
      url,
      context,
      EXPORT_PAGE_RESPONSE_MAX_BYTES
    );
    return competitorExportPage(payload, query.limit);
  }

  public async listExportPositionHistory(
    context: { readonly workspaceId: string; readonly projectId: string; readonly actorId: string },
    query: KeywordListQuery,
    options: SemanticPositionHistoryExportOptions
  ): Promise<ApiCollectionResponse<SemanticPositionHistoryExportRow>> {
    const url = new URL(
      `/internal/v1/projects/${encodeURIComponent(context.projectId)}/semantic-exports/position-history`,
      this.config.services.seoData
    );
    url.searchParams.set("limit", String(query.limit));
    if (query.cursor) url.searchParams.set("cursor", query.cursor);
    if (query.search) url.searchParams.set("search", query.search);
    if (query.tag) url.searchParams.set("tag", query.tag);
    if (query.intent) url.searchParams.set("intent", query.intent);
    if (query.groupId) url.searchParams.set("groupId", query.groupId);
    if (query.groupIds?.length) url.searchParams.set("groupIds", query.groupIds.join(","));
    if (query.clusterId) url.searchParams.set("clusterId", query.clusterId);
    if (query.isFavorite !== undefined) url.searchParams.set("isFavorite", String(query.isFavorite));
    if (query.isTracked !== undefined) url.searchParams.set("isTracked", String(query.isTracked));
    if (query.priorityMin !== undefined) url.searchParams.set("priorityMin", String(query.priorityMin));
    if (query.priorityMax !== undefined) url.searchParams.set("priorityMax", String(query.priorityMax));
    if (query.sort) url.searchParams.set("sort", query.sort);
    url.searchParams.set("observedFrom", options.observedFrom);
    url.searchParams.set("observedBefore", options.observedBefore);
    url.searchParams.set("searchEngines", options.searchEngines.join(","));
    const payload = await this.requestGetBounded(
      url,
      context,
      EXPORT_PAGE_RESPONSE_MAX_BYTES
    );
    return positionHistoryExportPage(payload, query.limit);
  }

  public async listExportKeywordGroups(
    context: { readonly workspaceId: string; readonly projectId: string; readonly actorId: string }
  ): Promise<readonly SemanticKeywordGroup[]> {
    const payload = await this.requestGetBounded(
      new URL(`/internal/v1/projects/${encodeURIComponent(context.projectId)}/semantic-exports/keyword-groups`, this.config.services.seoData),
      context,
      EXPORT_METADATA_RESPONSE_MAX_BYTES
    );
    const envelope = object(payload);
    if (!envelope || !Array.isArray(envelope.data)) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return envelope.data as readonly SemanticKeywordGroup[];
  }

  public async listExportCustomColumns(
    context: { readonly workspaceId: string; readonly projectId: string; readonly actorId: string }
  ): Promise<readonly SemanticCustomColumn[]> {
    const payload = await this.requestGetBounded(
      new URL(`/internal/v1/projects/${encodeURIComponent(context.projectId)}/semantic-exports/custom-columns`, this.config.services.seoData),
      context,
      EXPORT_METADATA_RESPONSE_MAX_BYTES
    );
    const envelope = object(payload);
    if (!envelope || !Array.isArray(envelope.data)) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return envelope.data as readonly SemanticCustomColumn[];
  }

  private async request(
    path: string,
    body: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
    }
  ): Promise<unknown> {
    const response = await this.fetch(path, body);
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw clientError(response.status, payload);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload)
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return payload.data;
  }

  private async requestStrictRankScope(
    path: string,
    body: InternalRankEstimateScopeQuery
  ): Promise<unknown> {
    const response = await this.fetch(path, body);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw clientError(response.status);
    }
    if (
      response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^(?:0|[1-9]\d*)$/u.test(contentLength) ||
        Number(contentLength) > RANK_SCOPE_RESPONSE_MAX_BYTES)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const payload = object(
      await boundedJson(response, RANK_SCOPE_RESPONSE_MAX_BYTES)
    );
    if (!payload) throw new SeoDataClientError("UNAVAILABLE", true);
    const envelopeFields = Object.keys(payload);
    if (
      envelopeFields.length !== 2 ||
      !envelopeFields.includes("data") ||
      !envelopeFields.includes("meta")
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const meta = exactObject(payload.meta, ["requestId"]);
    if (
      !meta ||
      typeof meta.requestId !== "string" ||
      meta.requestId.length < 1 ||
      meta.requestId.length > 200
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return payload.data;
  }

  private async requestBounded(
    path: string,
    body: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
    },
    maximumBytes: number,
    timeoutMs?: number
  ): Promise<unknown> {
    const response = await this.fetch(path, body, timeoutMs);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw clientError(response.status);
    }
    if (
      response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^(?:0|[1-9]\d*)$/u.test(contentLength) ||
        Number(contentLength) > maximumBytes)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const payload = exactObject(await boundedJson(response, maximumBytes), [
      "data",
      "meta"
    ]);
    if (!payload) throw new SeoDataClientError("UNAVAILABLE", true);
    const meta = exactObject(payload.meta, ["requestId"]);
    if (
      !meta ||
      typeof meta.requestId !== "string" ||
      meta.requestId.length < 1 ||
      meta.requestId.length > 200
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    return payload.data;
  }

  private async fetch(
    path: string,
    body: {
      readonly workspaceId: string;
      readonly projectId: string;
      readonly actorId: string;
    },
    timeoutMs = this.config.internalCommandTimeoutMs
  ): Promise<Response> {
    const token = this.config.seoDataApiToken;
    if (!token) throw new SeoDataClientError("UNAVAILABLE", true);
    try {
      return await fetch(new URL(path, this.config.services.seoData), {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Internal-Token": token,
          "X-Workspace-Id": body.workspaceId,
          "X-Project-Id": body.projectId,
          "X-Actor-Id": body.actorId
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
  }

  private async requestGetBounded(
    url: URL,
    context: { readonly workspaceId: string; readonly projectId: string; readonly actorId: string },
    maximumBytes: number
  ): Promise<unknown> {
    const token = this.config.seoDataApiToken;
    if (!token) throw new SeoDataClientError("UNAVAILABLE", true);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "X-Internal-Token": token,
          "X-Workspace-Id": context.workspaceId,
          "X-Project-Id": context.projectId,
          "X-Actor-Id": context.actorId
        },
        signal: AbortSignal.timeout(this.config.internalCommandTimeoutMs)
      });
    } catch {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw clientError(response.status);
    }
    return boundedJson(response, maximumBytes);
  }
}

const RANK_SCOPE_RESPONSE_MAX_BYTES = 64 * 1_024;
const FREQUENCY_RESOLVE_RESPONSE_MAX_BYTES = 4 * 1_024 * 1_024;
const FREQUENCY_PERSIST_RESPONSE_MAX_BYTES = 16 * 1_024;
const AI_ANSWER_RESOLVE_RESPONSE_MAX_BYTES = 4 * 1_024 * 1_024;
const AI_ANSWER_PERSIST_RESPONSE_MAX_BYTES = 16 * 1_024;
const CLUSTERING_RESOLVE_RESPONSE_MAX_BYTES = 4 * 1_024 * 1_024;
const CLUSTERING_PERSIST_RESPONSE_MAX_BYTES = 64 * 1_024;
export const CLUSTERING_PERSIST_COMMAND_TIMEOUT_MS = 90_000;
const EXPORT_PAGE_RESPONSE_MAX_BYTES = 16 * 1_024 * 1_024;
const EXPORT_METADATA_RESPONSE_MAX_BYTES = 4 * 1_024 * 1_024;

function clientError(
  status: number,
  payload?: unknown
): SeoDataClientError {
  if (status === 400 || status === 422) {
    return new SeoDataClientError("INVALID_COMMAND", false);
  }
  if (status === 404) {
    return new SeoDataClientError("NOT_FOUND", false);
  }
  if (status === 409) {
    if (responseErrorCode(payload) === "QUOTA_EXCEEDED") {
      return new SeoDataClientError("QUOTA_EXCEEDED", false);
    }
    return new SeoDataClientError("CONFLICT", false);
  }
  return new SeoDataClientError("UNAVAILABLE", true);
}

function responseErrorCode(value: unknown): string | undefined {
  const payload = object(value);
  if (typeof payload?.code === "string") return payload.code;
  const error = object(payload?.error);
  return typeof error?.code === "string" ? error.code : undefined;
}

function normalizedKeywords(
  value: unknown
): InternalNormalizeSemanticKeywordsResult | undefined {
  const payload = object(value);
  if (!payload || !Array.isArray(payload.rows)) return undefined;
  const rows: InternalNormalizedSemanticKeyword[] = [];
  for (const value of payload.rows) {
    const row = object(value);
    if (
      !row ||
      !strings(
        row,
        "rowNumber",
        "textOriginal",
        "textNormalized",
        "normalizedHash",
        "language"
      ) ||
      typeof row.existsInProject !== "boolean" ||
      !/^[a-f0-9]{64}$/u.test(row.normalizedHash as string)
    ) {
      return undefined;
    }
    rows.push(row as unknown as InternalNormalizedSemanticKeyword);
  }
  return { rows };
}

function importReceipt(
  value: unknown
): InternalSemanticImportReceipt | undefined {
  const payload = object(value);
  if (
    !payload ||
    typeof payload.importId !== "string" ||
    !["RECEIVING", "COMPLETED", "ABORTED"].includes(
      String(payload.status)
    ) ||
    !nonNegativeInteger(payload.receivedChunks) ||
    !nonNegativeInteger(payload.expectedChunks)
  ) {
    return undefined;
  }
  return payload as unknown as InternalSemanticImportReceipt;
}

function chunkResult(
  value: unknown
): InternalSemanticImportChunkResult | undefined {
  const payload = object(value);
  if (
    !payload ||
    !nonNegativeInteger(payload.chunkIndex) ||
    !strings(
      payload,
      "createdKeywords",
      "updatedKeywords",
      "skippedKeywords",
      "createdGroups",
      "createdPages",
      "createdTags",
      "createdMetricSnapshots"
    ) ||
    (payload.trashedDuplicateCandidates !== undefined &&
      !trashCandidates(payload.trashedDuplicateCandidates))
  ) {
    return undefined;
  }
  return {
    ...payload,
    trashedDuplicateCandidates:
      payload.trashedDuplicateCandidates ?? []
  } as unknown as InternalSemanticImportChunkResult;
}

function importResult(
  value: unknown
): SemanticImportResultSummary | undefined {
  const payload = object(value);
  if (
    !payload ||
    typeof payload.partial !== "boolean" ||
    !Number.isSafeInteger(payload.semanticVersionNumber) ||
    !strings(
      payload,
      "semanticVersionId",
      "createdKeywords",
      "updatedKeywords",
      "skippedKeywords",
      "createdGroups",
      "createdPages",
      "createdTags",
      "createdMetricSnapshots"
    ) ||
    (payload.trashedDuplicateCandidates !== undefined &&
      !trashCandidates(payload.trashedDuplicateCandidates)) ||
    (payload.trashedDuplicateCandidatesTruncated !== undefined &&
      typeof payload.trashedDuplicateCandidatesTruncated !== "boolean")
  ) {
    return undefined;
  }
  return payload as unknown as SemanticImportResultSummary;
}

function trashCandidates(value: unknown): boolean {
  return Array.isArray(value) &&
    value.length <= 2_000 &&
    value.every((candidate) => {
      const row = object(candidate);
      return Boolean(
        row &&
          typeof row.keywordId === "string" &&
          uuid(row.keywordId) &&
          positiveInteger(row.version) &&
          typeof row.text === "string" &&
          row.text.length > 0 &&
          row.text.length <= 2_000 &&
          typeof row.language === "string" &&
          row.language.length > 0 &&
          row.language.length <= 16
      );
    });
}

function abortImportResult(
  value: unknown
): InternalAbortSemanticImportResult | undefined {
  const payload = object(value);
  if (
    !payload ||
    typeof payload.importId !== "string" ||
    !["ABORTED", "RECEIVING", "COMPLETED"].includes(
      String(payload.status)
    ) ||
    !nonNegativeInteger(payload.receivedChunks)
  ) {
    return undefined;
  }
  return payload as unknown as InternalAbortSemanticImportResult;
}

function rankEstimateScope(
  value: unknown
): InternalRankEstimateScope | undefined {
  const payload = exactObject(value, [
    "workspaceId",
    "projectId",
    "trackingContextId",
    "contextStatus",
    "contextVersion",
    "configurationVersion",
    "configurationHash",
    "configuration",
    "keywordCount",
    "contextCount",
    "pairCount",
    "semanticScopeHash",
    "calculatedAt"
  ]);
  if (
    !payload ||
    !uuid(payload.workspaceId) ||
    !uuid(payload.projectId) ||
    !uuid(payload.trackingContextId) ||
    !["ACTIVE", "ARCHIVED"].includes(String(payload.contextStatus)) ||
    !positiveInteger(payload.contextVersion) ||
    !positiveInteger(payload.configurationVersion) ||
    Number(payload.configurationVersion) > Number(payload.contextVersion) ||
    !sha256(payload.configurationHash) ||
    payload.contextCount !== "1" ||
    !boundedDecimal(payload.keywordCount, rankProviderOverflowCount) ||
    payload.pairCount !== payload.keywordCount ||
    !isoTimestamp(payload.calculatedAt)
  ) {
    return undefined;
  }
  const configuration = trackingConfiguration(payload.configuration);
  const semanticScopeHash = scopeHash(payload.semanticScopeHash);
  if (
    !configuration ||
    !semanticScopeHash ||
    (payload.keywordCount === "0" &&
      semanticScopeHash.availability === "UNAVAILABLE") ||
    (payload.keywordCount === String(rankProviderOverflowCount) &&
      semanticScopeHash.availability === "AVAILABLE")
  ) {
    return undefined;
  }
  return {
    workspaceId: payload.workspaceId as string,
    projectId: payload.projectId as string,
    trackingContextId: payload.trackingContextId as string,
    contextStatus:
      payload.contextStatus as InternalRankEstimateScope["contextStatus"],
    contextVersion: Number(payload.contextVersion),
    configurationVersion: Number(payload.configurationVersion),
    configurationHash: payload.configurationHash as string,
    configuration,
    keywordCount: payload.keywordCount as string,
    contextCount: "1",
    pairCount: payload.pairCount as string,
    semanticScopeHash,
    calculatedAt: payload.calculatedAt as string
  };
}

function trackingConfiguration(
  value: unknown
): TrackingContextConfigurationInput | undefined {
  const payload = object(value);
  if (!payload) return undefined;
  const domainMatchRule = trackingDomainMatchRule(payload.domainMatchRule);
  const optional = ["regionCode", "regionLabel"].filter(
    (field) => field in payload
  );
  const allowed = new Set([
    "searchEngine",
    "countryCode",
    "language",
    "device",
    "depth",
    "domainMatchRule",
    "safeSearch",
    ...optional
  ]);
  if (
    Object.keys(payload).some((field) => !allowed.has(field)) ||
    !["GOOGLE", "YANDEX"].includes(String(payload.searchEngine)) ||
    typeof payload.countryCode !== "string" ||
    !/^[A-Z]{2}$/u.test(payload.countryCode) ||
    !canonicalLanguage(payload.language) ||
    !["DESKTOP", "MOBILE"].includes(String(payload.device)) ||
    ![30, 50, 100].includes(Number(payload.depth)) ||
    typeof payload.safeSearch !== "boolean" ||
    !domainMatchRule ||
    !optionalString(payload, "regionCode", 100) ||
    !optionalString(payload, "regionLabel", 160) ||
    (typeof payload.regionLabel === "string" &&
      typeof payload.regionCode !== "string")
  ) {
    return undefined;
  }
  return {
    searchEngine:
      payload.searchEngine as TrackingContextConfigurationInput["searchEngine"],
    countryCode: payload.countryCode,
    ...(typeof payload.regionCode === "string"
      ? { regionCode: payload.regionCode }
      : {}),
    ...(typeof payload.regionLabel === "string"
      ? { regionLabel: payload.regionLabel }
      : {}),
    language: payload.language,
    device: payload.device as TrackingContextConfigurationInput["device"],
    depth: Number(payload.depth) as TrackingContextConfigurationInput["depth"],
    domainMatchRule,
    safeSearch: payload.safeSearch
  };
}

function trackingDomainMatchRule(
  value: unknown
): TrackingContextConfigurationInput["domainMatchRule"] | undefined {
  const payload = object(value);
  if (!payload || typeof payload.mode !== "string") return undefined;
  if (["SPECIFIC_URL", "URL_PREFIX"].includes(payload.mode)) {
    if (
      Object.keys(payload).length !== 2 ||
      typeof payload.value !== "string" ||
      payload.value !== payload.value.trim() ||
      payload.value.length < 1 ||
      payload.value.length > 2_048
    ) {
      return undefined;
    }
    return {
      mode: payload.mode as "SPECIFIC_URL" | "URL_PREFIX",
      value: payload.value
    };
  }
  if (
    Object.keys(payload).length !== 1 ||
    ![
      "EXACT_HOST",
      "INCLUDE_WWW",
      "INCLUDE_SUBDOMAINS",
      "CANONICAL_DOMAIN",
      "ANY_PROJECT_MIRROR"
    ].includes(payload.mode)
  ) {
    return undefined;
  }
  return {
    mode: payload.mode as Exclude<
      TrackingContextConfigurationInput["domainMatchRule"]["mode"],
      "SPECIFIC_URL" | "URL_PREFIX"
    >
  };
}

function scopeHash(
  value: unknown
): InternalRankEstimateScope["semanticScopeHash"] | undefined {
  const payload = object(value);
  if (
    !payload ||
    !["AVAILABLE", "UNAVAILABLE"].includes(String(payload.availability))
  ) {
    return undefined;
  }
  if (payload.availability === "UNAVAILABLE") {
    return Object.keys(payload).length === 1
      ? { availability: "UNAVAILABLE" }
      : undefined;
  }
  return Object.keys(payload).length === 3 &&
    payload.algorithm === "SHA_256" &&
    sha256(payload.value)
    ? {
        availability: "AVAILABLE",
        algorithm: "SHA_256",
        value: payload.value as string
      }
    : undefined;
}

function positionHistoryExportPage(
  value: unknown,
  limit: number
): ApiCollectionResponse<SemanticPositionHistoryExportRow> {
  const envelope = object(value);
  const page = envelope ? object(envelope.page) : undefined;
  if (
    !envelope ||
    !Array.isArray(envelope.data) ||
    envelope.data.length > limit ||
    !page ||
    typeof page.hasNext !== "boolean" ||
    (page.nextCursor !== undefined && typeof page.nextCursor !== "string") ||
    (page.totalApprox !== undefined && !nonNegativeInteger(page.totalApprox))
  ) {
    throw new SeoDataClientError("UNAVAILABLE", true);
  }
  for (const item of envelope.data) {
    const row = object(item);
    if (
      !row ||
      Object.keys(row).some((field) => !["keywordId", "text", "createdAt", "groupPath", "snapshots"].includes(field)) ||
      !uuid(row.keywordId) ||
      typeof row.text !== "string" ||
      row.text.length < 1 ||
      row.text.length > 2_000 ||
      !isoTimestamp(row.createdAt) ||
      (row.groupPath !== undefined && (typeof row.groupPath !== "string" || row.groupPath.length > 4_096)) ||
      !Array.isArray(row.snapshots) ||
      row.snapshots.length > 2_200
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const identities = new Set<string>();
    for (const itemSnapshot of row.snapshots) {
      const snapshot = object(itemSnapshot);
      if (
        !snapshot ||
        Object.keys(snapshot).some((field) => !["searchEngine", "observedDate", "found", "position"].includes(field)) ||
        !["GOOGLE", "YANDEX"].includes(String(snapshot.searchEngine)) ||
        !canonicalDate(snapshot.observedDate) ||
        typeof snapshot.found !== "boolean" ||
        (snapshot.found
          ? !Number.isSafeInteger(snapshot.position) || Number(snapshot.position) < 1 || Number(snapshot.position) > 100
          : snapshot.position !== undefined)
      ) {
        throw new SeoDataClientError("UNAVAILABLE", true);
      }
      const identity = `${snapshot.searchEngine}:${snapshot.observedDate}`;
      if (identities.has(identity)) {
        throw new SeoDataClientError("UNAVAILABLE", true);
      }
      identities.add(identity);
    }
  }
  return {
    data: envelope.data as readonly SemanticPositionHistoryExportRow[],
    page: {
      hasNext: page.hasNext as boolean,
      ...(typeof page.nextCursor === "string" ? { nextCursor: page.nextCursor } : {}),
      ...(page.totalApprox === undefined ? {} : { totalApprox: Number(page.totalApprox) })
    },
    meta: { requestId: "internal-semantic-position-history-export" }
  };
}

function competitorExportPage(
  value: unknown,
  limit: number
): ApiCollectionResponse<SemanticCompetitorExportKeyword> {
  const envelope = object(value);
  const page = envelope ? object(envelope.page) : undefined;
  if (
    !envelope ||
    !Array.isArray(envelope.data) ||
    envelope.data.length > limit ||
    !page ||
    typeof page.hasNext !== "boolean" ||
    (page.nextCursor !== undefined && typeof page.nextCursor !== "string") ||
    (page.totalApprox !== undefined && !nonNegativeInteger(page.totalApprox))
  ) {
    throw new SeoDataClientError("UNAVAILABLE", true);
  }
  for (const candidate of envelope.data) {
    const row = exactObject(candidate, ["keywordId", "competitors"]);
    if (
      !row ||
      !uuid(row.keywordId) ||
      !Array.isArray(row.competitors) ||
      row.competitors.length > 500
    ) {
      throw new SeoDataClientError("UNAVAILABLE", true);
    }
    const identities = new Set<string>();
    for (const competitor of row.competitors) {
      const item = object(competitor);
      if (
        !item ||
        Object.keys(item).some((field) =>
          !["source", "url", "normalizedUrl", "title", "description"].includes(field)
        ) ||
        !["SERP", "AI"].includes(String(item.source)) ||
        !validHttpUrl(item.url) ||
        !validHttpUrl(item.normalizedUrl) ||
        (item.title !== undefined &&
          (typeof item.title !== "string" || item.title.length > 50_000)) ||
        (item.description !== undefined &&
          (typeof item.description !== "string" || item.description.length > 50_000)) ||
        identities.has(`${String(item.source)}:${String(item.normalizedUrl)}`)
      ) {
        throw new SeoDataClientError("UNAVAILABLE", true);
      }
      identities.add(`${String(item.source)}:${String(item.normalizedUrl)}`);
    }
  }
  return {
    data: envelope.data as readonly SemanticCompetitorExportKeyword[],
    page: {
      hasNext: page.hasNext as boolean,
      ...(typeof page.nextCursor === "string" ? { nextCursor: page.nextCursor } : {}),
      ...(page.totalApprox === undefined ? {} : { totalApprox: Number(page.totalApprox) })
    },
    meta: { requestId: "internal-semantic-competitor-export" }
  };
}

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192) {
    return false;
  }
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function canonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function object(
  value: unknown
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function exactObject(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  const payload = object(value);
  if (!payload) return undefined;
  const allowed = new Set(fields);
  return Object.keys(payload).length === fields.length &&
    Object.keys(payload).every((field) => allowed.has(field)) &&
    fields.every((field) => field in payload)
    ? payload
    : undefined;
}

function clusteringProposalSummary(
  value: unknown,
  input: InternalPersistClusteringProposalInput
): ClusteringProposalSummary {
  const payload = object(value);
  const required = [
    "id", "jobId", "status", "keywordCount", "clusterCount", "unclusteredCount",
    "readyCount", "protectedCount", "conflictedCount", "appliedKeywordCount",
    "createdGroupCount", "semanticVersionIds", "version", "createdAt", "updatedAt"
  ] as const;
  const optional = ["appliedAt", "rejectedAt"] as const;
  if (
    !payload ||
    required.some((field) => !(field in payload)) ||
    Object.keys(payload).some((field) => !required.includes(field as never) && !optional.includes(field as never)) ||
    !uuid(payload.id) ||
    payload.jobId !== input.jobId ||
    !["READY", "APPLIED", "REJECTED"].includes(String(payload.status)) ||
    payload.keywordCount !== input.items.length ||
    payload.clusterCount !== input.clusters.length ||
    !nonNegativeInteger(payload.unclusteredCount) ||
    Number(payload.unclusteredCount) > input.items.length ||
    !nonNegativeInteger(payload.readyCount) ||
    !nonNegativeInteger(payload.protectedCount) ||
    !nonNegativeInteger(payload.conflictedCount) ||
    Number(payload.readyCount) + Number(payload.protectedCount) + Number(payload.conflictedCount) > input.items.length ||
    !nonNegativeInteger(payload.appliedKeywordCount) ||
    Number(payload.appliedKeywordCount) > input.items.length ||
    !nonNegativeInteger(payload.createdGroupCount) ||
    Number(payload.createdGroupCount) > input.clusters.length + 1 ||
    !Array.isArray(payload.semanticVersionIds) ||
    payload.semanticVersionIds.length > input.items.length + input.clusters.length ||
    payload.semanticVersionIds.some((id) => !uuid(id)) ||
    new Set(payload.semanticVersionIds).size !== payload.semanticVersionIds.length ||
    !positiveInteger(payload.version) ||
    !isoTimestamp(payload.createdAt) ||
    !isoTimestamp(payload.updatedAt) ||
    (payload.appliedAt !== undefined && !isoTimestamp(payload.appliedAt)) ||
    (payload.rejectedAt !== undefined && !isoTimestamp(payload.rejectedAt)) ||
    (payload.status === "APPLIED" && payload.appliedAt === undefined) ||
    (payload.status === "REJECTED" && payload.rejectedAt === undefined)
  ) throw new SeoDataClientError("UNAVAILABLE", true);
  return payload as unknown as ClusteringProposalSummary;
}

function strings(
  value: Readonly<Record<string, unknown>>,
  ...fields: readonly string[]
): boolean {
  return fields.every((field) => typeof value[field] === "string");
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function boundedDecimal(value: unknown, maximum: number): boolean {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return false;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum;
}

function sha256(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function uuid(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  );
}

function isoTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
  );
}

function optionalString(
  value: Readonly<Record<string, unknown>>,
  field: string,
  maximum: number
): boolean {
  return (
    !(field in value) ||
    (typeof value[field] === "string" &&
      value[field] === (value[field] as string).trim() &&
      (value[field] as string).length >= 1 &&
      (value[field] as string).length <= maximum)
  );
}

function canonicalLanguage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 16) return false;
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

async function boundedJson(
  response: Response,
  maximumBytes: number
): Promise<unknown> {
  if (!response.body) {
    throw new SeoDataClientError("UNAVAILABLE", true);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new SeoDataClientError("UNAVAILABLE", true);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SeoDataClientError) throw error;
    throw new SeoDataClientError("UNAVAILABLE", true);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SeoDataClientError("UNAVAILABLE", true);
  }
}
