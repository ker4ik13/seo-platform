export const technicalCrawlStatuses = [
  "QUEUED",
  "RUNNING",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "FAILED"
] as const;

export type TechnicalCrawlStatus =
  (typeof technicalCrawlStatuses)[number];

export const technicalCrawlQueryPolicies = [
  "DROP_TRACKING",
  "DROP_ALL",
  "PRESERVE"
] as const;

export type TechnicalCrawlQueryPolicy =
  (typeof technicalCrawlQueryPolicies)[number];

export interface TechnicalCrawlConfig {
  readonly startUrls: readonly string[];
  readonly sitemapUrls: readonly string[];
  readonly includePatterns: readonly string[];
  readonly excludePatterns: readonly string[];
  readonly queryPolicy: TechnicalCrawlQueryPolicy;
  readonly maxUrls: number;
  readonly maxDepth: number;
  readonly requestsPerMinute: number;
  readonly obeyRobots: true;
}

export interface CreateTechnicalCrawlInput
  extends TechnicalCrawlConfig {}

export interface TechnicalCrawlSummary {
  readonly id: string;
  readonly jobId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly status: TechnicalCrawlStatus;
  readonly config: TechnicalCrawlConfig;
  readonly discoveredUrls: number;
  readonly processedUrls: number;
  readonly successfulUrls: number;
  readonly failedUrls: number;
  readonly issueCount: number;
  readonly failureCode?: string;
  readonly backoffCode?:
    | "HOST_RATE_LIMIT"
    | "HOST_UNAVAILABLE"
    | "HOST_NETWORK_ERROR"
    | "LATENCY_SPIKE";
  readonly backoffUntil?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly cancelRequestedAt?: string;
}

export interface TechnicalCrawlCollection {
  readonly crawls: readonly TechnicalCrawlSummary[];
}

export interface TechnicalCrawlAccess {
  readonly canRun: boolean;
  readonly mutationRestriction:
    | "NONE"
    | "MISSING_PERMISSION"
    | "WORKSPACE_READ_ONLY"
    | "PROJECT_ARCHIVED";
}

export interface TechnicalCrawlSettings
  extends TechnicalCrawlCollection {
  readonly access: TechnicalCrawlAccess;
}

export interface InternalCreateTechnicalCrawlInput
  extends CreateTechnicalCrawlInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface InternalCancelTechnicalCrawlInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export type CrawlIssueSeverity =
  | "INFO"
  | "WARNING"
  | "ERROR"
  | "CRITICAL";

export type CrawlPageIndexability =
  | "INDEXABLE"
  | "NOINDEX"
  | "CANONICALIZED"
  | "REDIRECTED"
  | "ERROR"
  | "UNKNOWN";

export interface CrawlPageIssueEvidence {
  readonly code: string;
  readonly severity: CrawlIssueSeverity;
  readonly title: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

export interface InternalPersistCrawlPageInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly sequence: number;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly redirectChain: readonly string[];
  readonly inSitemap: boolean;
  readonly depth: number;
  readonly statusCode: number;
  readonly responseTimeMs: number;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly title?: string;
  readonly description?: string;
  readonly h1?: string;
  readonly h1Count: number;
  readonly canonicalUrl?: string;
  readonly robots?: string;
  readonly language?: string;
  readonly headings: readonly {
    readonly level: number;
    readonly text: string;
  }[];
  readonly hreflang: readonly {
    readonly language: string;
    readonly url: string;
  }[];
  readonly internalLinks: readonly string[];
  readonly externalLinks: readonly string[];
  readonly imageCount: number;
  readonly imagesMissingAlt: number;
  readonly structuredDataTypes: readonly string[];
  readonly wordCount: number;
  readonly contentHash: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly indexability: CrawlPageIndexability;
  readonly issues: readonly CrawlPageIssueEvidence[];
  readonly crawledAt: string;
}

export interface InternalPersistCrawlPageReceipt {
  readonly accepted: true;
  readonly issueCount: number;
  readonly success: boolean;
}

export interface InternalGetCrawlPageValidatorInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly url: string;
}

export interface InternalCrawlPageValidator {
  readonly sourceSnapshotId: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly internalLinks: readonly string[];
}

export interface InternalReuseCrawlPageInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly sequence: number;
  readonly sourceSnapshotId: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly redirectChain: readonly string[];
  readonly inSitemap: boolean;
  readonly depth: number;
  readonly crawledAt: string;
}

export interface InternalFinalizeCrawlSnapshotInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly crawlId: string;
  readonly status: "COMPLETED" | "PARTIALLY_COMPLETED" | "CANCELLED";
  readonly processedUrls: number;
}

export interface ProjectCrawlIssueSummary {
  readonly id: string;
  readonly crawlId: string;
  readonly pageId: string;
  readonly url: string;
  readonly code: string;
  readonly severity: CrawlIssueSeverity;
  readonly title: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly occurrences: number;
  readonly resolvedAt?: string;
}

export interface ProjectCrawlIssueCollection {
  readonly issues: readonly ProjectCrawlIssueSummary[];
}

export const crawlPageChangeFields = [
  "statusCode",
  "redirectChain",
  "inSitemap",
  "title",
  "description",
  "h1",
  "h1Count",
  "headings",
  "canonicalUrl",
  "robots",
  "language",
  "hreflang",
  "internalLinks",
  "externalLinks",
  "imageCount",
  "imagesMissingAlt",
  "structuredDataTypes",
  "wordCount",
  "contentHash",
  "indexability",
  "responseTimeMs",
  "sizeBytes"
] as const;

export type CrawlPageChangeField =
  (typeof crawlPageChangeFields)[number];

export interface ProjectCrawlPageChangeSummary {
  readonly id: string;
  readonly crawlId: string;
  readonly pageId: string;
  readonly url: string;
  readonly severity: CrawlIssueSeverity;
  readonly changedFields: readonly CrawlPageChangeField[];
  readonly previousCrawledAt: string;
  readonly currentCrawledAt: string;
  readonly createdAt: string;
}

export interface ProjectCrawlPageChangeCollection {
  readonly changes: readonly ProjectCrawlPageChangeSummary[];
}
