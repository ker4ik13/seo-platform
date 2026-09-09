import type {
  TechnicalCrawlSummary,
  CrawlIssueSeverity
} from "./crawls.js";
import type { PageIndexability } from "./pages.js";
import type {
  FrequencyCollectionSummary,
  FrequencySeasonalityPointSummary,
  FrequencySnapshotSummary
} from "./frequency-collections.js";
import type { AiAnswerCollectionSummary } from "./ai-answer-collections.js";
import type {
  InternalRankExecutionParameters,
  NormalizedRankDataQualityFlag,
  RankJobSummary
} from "./rank-runs.js";

/** Product depth of one immutable competitor SERP shown in operation results. */
export const competitorSerpOperationResultDepth = 100 as const;

export const operationResultItemStatuses = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "CANCELLED"
] as const;

export type OperationResultItemStatus =
  (typeof operationResultItemStatuses)[number];

export const operationResultPageSizes = [200, 500] as const;
export type OperationResultPageSize =
  (typeof operationResultPageSizes)[number];
export const operationResultDefaultPageSize: OperationResultPageSize = 200;

export interface OperationResultPageInfo {
  readonly hasNext: boolean;
  readonly nextCursor?: string;
}

/** Jobs-owned exact scope of one frequency collection. */
export interface InternalFrequencyOperationScopeItem {
  readonly sequence: number;
  readonly keywordId: string;
  readonly status: OperationResultItemStatus;
  readonly errorCode?: string;
}

export interface InternalFrequencyOperationScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly items: readonly InternalFrequencyOperationScopeItem[];
  readonly page: OperationResultPageInfo;
}

/** Trusted Platform API -> SEO Data request; browser identities are headers. */
export interface InternalFrequencyOperationResultInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly keywordIds: readonly string[];
}

export interface InternalFrequencyOperationResultRow {
  /** Current editable version, omitted for removed/inactive keywords. */
  readonly keywordVersion?: number;
  readonly keywordAvailable?: boolean;
  readonly keywordId: string;
  readonly keyword: string;
  readonly snapshots: readonly FrequencySnapshotSummary[];
  readonly seasonality: readonly FrequencySeasonalityPointSummary[];
}

export interface InternalFrequencyOperationResult {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly rows: readonly InternalFrequencyOperationResultRow[];
}

export interface FrequencyOperationResultRow
  extends InternalFrequencyOperationResultRow {
  readonly sequence: number;
  readonly status: OperationResultItemStatus;
  readonly errorCode?: string;
}

export interface FrequencyOperationResult {
  readonly collection: FrequencyCollectionSummary;
  readonly rows: readonly FrequencyOperationResultRow[];
  readonly page: OperationResultPageInfo;
}

/** Jobs-owned exact scope and execution state of one AI answer collection. */
export interface InternalAiAnswerOperationScopeItem {
  readonly sequence: number;
  readonly keywordId: string;
  readonly status: OperationResultItemStatus;
  readonly attempt: number;
  readonly providerSubmitted: boolean;
  readonly errorCode?: string;
  readonly updatedAt: string;
}

export interface InternalAiAnswerOperationScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly items: readonly InternalAiAnswerOperationScopeItem[];
  readonly page: OperationResultPageInfo;
}

/** Trusted Platform API -> SEO Data request; browser identities are headers. */
export interface InternalAiAnswerOperationResultInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly keywordIds: readonly string[];
  /** Safe source rows are requested only by the competitor result view. */
  readonly includeSources: boolean;
}

export interface AiAnswerOperationSnapshotSummary {
  readonly answerPresent: boolean;
  readonly siteFound: boolean;
  readonly position?: number;
  readonly rankingUrl?: string;
  readonly brandFound: boolean;
  readonly sourceCount: number;
  /** Included only for a competitor SERP result view. */
  readonly sources?: readonly AiAnswerOperationSourceSummary[];
  readonly observedAt: string;
}

export interface AiAnswerOperationSourceSummary {
  readonly position: number;
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
}

export interface InternalAiAnswerOperationResultRow {
  readonly keywordId: string;
  readonly keyword: string;
  readonly snapshot?: AiAnswerOperationSnapshotSummary;
}

export interface InternalAiAnswerOperationResult {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly rows: readonly InternalAiAnswerOperationResultRow[];
}

export interface AiAnswerOperationResultRow
  extends InternalAiAnswerOperationResultRow,
    InternalAiAnswerOperationScopeItem {}

export interface AiAnswerOperationResult {
  readonly collection: AiAnswerCollectionSummary;
  readonly rows: readonly AiAnswerOperationResultRow[];
  readonly page: OperationResultPageInfo;
}

/** Jobs-owned per-key execution state for an XMLStock rank run. */
export interface InternalRankOperationScopeItem {
  readonly sequence: number;
  readonly status: OperationResultItemStatus;
  readonly pollAttempts: number;
  readonly errorCode?: string;
}

export interface InternalRankOperationScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly items: readonly InternalRankOperationScopeItem[];
  readonly page: OperationResultPageInfo;
}

export interface RankOperationResultRow {
  readonly sequence: number;
  readonly keywordId: string;
  /** Current tenant-visible keyword label, not the secret-bearing manifest field. */
  readonly keyword: string;
  /** Current version for an explicit new run; never changes the sealed manifest. */
  readonly keywordVersion?: number;
  readonly keywordAvailable?: boolean;
  readonly state: "PENDING" | "FOUND" | "NOT_FOUND";
  /** Present for one-key-per-task providers such as XMLStock. */
  readonly status?: OperationResultItemStatus;
  /** Number of real provider poll requests; local capacity deferrals are excluded. */
  readonly pollAttempts?: number;
  readonly errorCode?: string;
  readonly position?: number;
  readonly absolutePosition?: number;
  readonly pixelPosition?: number;
  readonly rankingUrl?: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly observedAt?: string;
  /** Included only for COMPETITOR_SERP; bounded by the selected depth, at most Top-100. */
  readonly serpResults?: readonly RankOperationSerpResult[];
  readonly dataQualityFlags: readonly NormalizedRankDataQualityFlag[];
}

export interface RankOperationSerpResult {
  readonly position: number;
  readonly rankingUrl: string;
  readonly faviconUrl?: string;
  readonly title?: string;
  readonly snippet?: string;
}

/** Current persisted outcomes across the complete immutable rank manifest. */
export interface RankOperationResultCounts {
  readonly foundCount: number;
  readonly notFoundCount: number;
}

export interface InternalRankOperationResult {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly trackingContextId: string;
  readonly contextName: string;
  readonly execution: InternalRankExecutionParameters;
  /** Independent from the cursor-paginated rows below. */
  readonly counts: RankOperationResultCounts;
  readonly rows: readonly RankOperationResultRow[];
  readonly page: OperationResultPageInfo;
}

export interface RankOperationResult
  extends Omit<InternalRankOperationResult, "workspaceId" | "projectId"> {
  readonly job: RankJobSummary;
}

export interface CrawlOperationIssue {
  readonly code: string;
  readonly severity: CrawlIssueSeverity;
  readonly title: string;
}

export interface CrawlOperationResultRow {
  readonly sequence: number;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly redirectChain: readonly string[];
  readonly statusCode: number;
  readonly responseTimeMs: number;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly title?: string;
  readonly h1?: string;
  readonly canonicalUrl?: string;
  readonly indexability: PageIndexability;
  readonly inSitemap: boolean;
  readonly depth: number;
  readonly wordCount: number;
  readonly internalLinkCount: number;
  readonly externalLinkCount: number;
  readonly issues: readonly CrawlOperationIssue[];
  readonly crawledAt: string;
}

export interface InternalCrawlOperationResultPage {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly rows: readonly CrawlOperationResultRow[];
  readonly page: OperationResultPageInfo;
}

export interface CrawlOperationResultPage
  extends Omit<
    InternalCrawlOperationResultPage,
    "workspaceId" | "projectId"
  > {
  readonly crawl: TechnicalCrawlSummary;
}
