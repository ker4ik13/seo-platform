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

export const technicalCrawlPurposes = [
  "TECHNICAL_AUDIT",
  "HTTP_STATUS_CHECK"
] as const;

export type TechnicalCrawlPurpose =
  (typeof technicalCrawlPurposes)[number];

export const technicalCrawlStartUrlLimit = 1_000;
export const technicalCrawlMaxUrlLimit = 1_000;
export const technicalCrawlMaxRequestsPerMinute = 60;

export const technicalCrawlQueryPolicies = [
  "DROP_TRACKING",
  "DROP_ALL",
  "PRESERVE"
] as const;

export type TechnicalCrawlQueryPolicy =
  (typeof technicalCrawlQueryPolicies)[number];

export const technicalCrawlHomepageChecks = [
  "HTTP_TO_HTTPS",
  "WWW_CANONICAL",
  "MULTIPLE_SLASHES"
] as const;

export type TechnicalCrawlHomepageCheck =
  (typeof technicalCrawlHomepageChecks)[number];

export interface TechnicalCrawlConfig {
  readonly purpose: TechnicalCrawlPurpose;
  readonly startUrls: readonly string[];
  /** Optional homepage redirect probes used only by HTTP_STATUS_CHECK. */
  readonly homepageChecks?: readonly TechnicalCrawlHomepageCheck[];
  readonly sitemapUrls: readonly string[];
  readonly includePatterns: readonly string[];
  readonly excludePatterns: readonly string[];
  readonly queryPolicy: TechnicalCrawlQueryPolicy;
  readonly maxUrls: number;
  readonly maxDepth: number;
  readonly maxRuntimeSeconds: number;
  readonly requestsPerMinute: number;
  readonly obeyRobots: true;
}

export function technicalCrawlHomepageProbeUrls(
  startUrl: string,
  checks: readonly TechnicalCrawlHomepageCheck[]
): readonly string[] {
  const root = new URL(startUrl);
  root.pathname = "/";
  root.search = "";
  root.hash = "";
  const canonical = root.toString();
  const candidates: string[] = [];

  if (checks.includes("HTTP_TO_HTTPS")) {
    const http = new URL(canonical);
    http.protocol = "http:";
    http.port = "";
    candidates.push(http.toString());
  }
  if (
    checks.includes("WWW_CANONICAL") &&
    !root.hostname.includes(":") &&
    !/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(root.hostname)
  ) {
    const www = new URL(canonical);
    www.hostname = www.hostname.startsWith("www.")
      ? www.hostname.slice(4)
      : `www.${www.hostname}`;
    www.port = "";
    candidates.push(www.toString());
  }
  if (checks.includes("MULTIPLE_SLASHES")) {
    for (let count = 2; count <= 5; count += 1) {
      const slashes = new URL(canonical);
      slashes.pathname = "/".repeat(count);
      candidates.push(slashes.toString());
    }
  }

  return [...new Set(candidates)].filter((url) => url !== canonical);
}

export interface CreateTechnicalCrawlInput
  extends Omit<TechnicalCrawlConfig, "maxRuntimeSeconds" | "purpose"> {
  /** Defaults to TECHNICAL_AUDIT for existing clients. */
  readonly purpose?: TechnicalCrawlPurpose;
  readonly maxRuntimeSeconds?: number;
}

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
    | "LATENCY_SPIKE"
    | "SITE_PAUSED";
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
  extends TechnicalCrawlConfig {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly jobCapacity: JobCapacityEntitlement;
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
  /** Defaults to TECHNICAL_AUDIT for backward-compatible internal callers. */
  readonly purpose?: TechnicalCrawlPurpose;
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
  /** Defaults to TECHNICAL_AUDIT for backward-compatible internal callers. */
  readonly purpose?: TechnicalCrawlPurpose;
  readonly status: "COMPLETED" | "PARTIALLY_COMPLETED" | "CANCELLED";
  readonly processedUrls: number;
  readonly scopeHash: string;
}

export interface InternalFinalizeCrawlSnapshotReceipt {
  readonly accepted: true;
  readonly issueCount: number;
}

export interface InternalDeliverCrawlNotificationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly crawlId: string;
  /** Defaults to TECHNICAL_AUDIT for notifications queued before this field existed. */
  readonly purpose?: TechnicalCrawlPurpose;
  readonly status:
    | "COMPLETED"
    | "PARTIALLY_COMPLETED"
    | "CANCELLED"
    | "FAILED";
  readonly processedUrls: number;
  readonly issueCount: number;
  readonly idempotencyKey: string;
}

export interface InternalDeliverCrawlNotificationReceipt {
  readonly accepted: true;
  readonly outcome: "CREATED" | "EXISTING" | "SKIPPED";
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

export interface ProjectCrawlAbsentPageSummary {
  readonly pageId: string;
  readonly url: string;
  readonly previousCrawlId: string;
  readonly previousSnapshotId: string;
  readonly wasInSitemap: boolean;
  readonly lastSeenAt: string;
  readonly detectedAt: string;
}

export interface ProjectCrawlAbsentPageCollection {
  readonly crawlId: string;
  readonly pages: readonly ProjectCrawlAbsentPageSummary[];
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

export const crawlDuplicateKinds = [
  "CONTENT",
  "TITLE",
  "DESCRIPTION",
  "H1"
] as const;

export type CrawlDuplicateKind = (typeof crawlDuplicateKinds)[number];

export interface ProjectCrawlDuplicateGroupMember {
  readonly pageId: string;
  readonly url: string;
}

export interface ProjectCrawlDuplicateGroupSummary {
  readonly id: string;
  readonly crawlId: string;
  readonly kind: CrawlDuplicateKind;
  readonly memberCount: number;
  readonly members: readonly ProjectCrawlDuplicateGroupMember[];
  readonly createdAt: string;
}

export interface ProjectCrawlDuplicateGroupCollection {
  readonly groups: readonly ProjectCrawlDuplicateGroupSummary[];
}
import type { JobCapacityEntitlement } from "./billing.js";
