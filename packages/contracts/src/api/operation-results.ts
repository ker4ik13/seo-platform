import type {
  TechnicalCrawlSummary,
  CrawlIssueSeverity
} from "./crawls.js";
import type { PageIndexability } from "./pages.js";
import type {
  FrequencyCollectionSummary,
  FrequencySnapshotSummary
} from "./frequency-collections.js";
import type { AiAnswerCollectionSummary } from "./ai-answer-collections.js";
import type {
  InternalRankExecutionParameters,
  NormalizedRankDataQualityFlag,
  RankJobSummary
} from "./rank-runs.js";

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
  readonly keywordId: string;
  readonly keyword: string;
  readonly snapshots: readonly FrequencySnapshotSummary[];
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
}

export interface AiAnswerOperationSnapshotSummary {
  readonly answerPresent: boolean;
  readonly siteFound: boolean;
  readonly position?: number;
  readonly rankingUrl?: string;
  readonly brandFound: boolean;
  readonly sourceCount: number;
  readonly observedAt: string;
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

export interface RankOperationResultRow {
  readonly sequence: number;
  readonly keywordId: string;
  /** Current tenant-visible keyword label, not the secret-bearing manifest field. */
  readonly keyword: string;
  readonly state: "PENDING" | "FOUND" | "NOT_FOUND";
  readonly position?: number;
  readonly absolutePosition?: number;
  readonly pixelPosition?: number;
  readonly rankingUrl?: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly observedAt?: string;
  readonly dataQualityFlags: readonly NormalizedRankDataQualityFlag[];
}

export interface InternalRankOperationResult {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly trackingContextId: string;
  readonly contextName: string;
  readonly execution: InternalRankExecutionParameters;
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
