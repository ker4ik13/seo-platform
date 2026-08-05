export const pageTypes = [
  "EXISTING",
  "PLANNED",
  "REDIRECTED",
  "DELETED",
  "EXTERNAL",
  "UNKNOWN"
] as const;

export type PageType = (typeof pageTypes)[number];

export const pageIndexabilities = [
  "UNKNOWN",
  "INDEXABLE",
  "NOINDEX",
  "BLOCKED_ROBOTS",
  "CANONICALIZED",
  "REDIRECTED",
  "ERROR"
] as const;

export type PageIndexability = (typeof pageIndexabilities)[number];

export const pageSourceTypes = [
  "CRAWL",
  "SITEMAP",
  "SEARCH_CONSOLE",
  "WEBMASTER",
  "ANALYTICS",
  "MANUAL",
  "IMPORT",
  "CMS"
] as const;

export type PageSourceType = (typeof pageSourceTypes)[number];

export const pageContentStatuses = [
  "IDEA",
  "RESEARCH",
  "BRIEF",
  "WRITING",
  "REVIEW",
  "APPROVED",
  "PUBLISHING",
  "PUBLISHED",
  "OPTIMIZATION",
  "PAUSED",
  "REJECTED",
  "ARCHIVED"
] as const;

export type PageContentStatus = (typeof pageContentStatuses)[number];

export const pageLifecycleStatuses = ["ACTIVE", "ARCHIVED"] as const;

export type PageLifecycleStatus = (typeof pageLifecycleStatuses)[number];

export interface PageAliasSummary {
  readonly id: string;
  readonly url: string;
  readonly normalizedUrl: string;
  readonly source: PageSourceType;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export interface PageSourceSummary {
  readonly source: PageSourceType;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export interface ProjectPageSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly url: string;
  readonly normalizedUrl: string;
  readonly aliases: readonly PageAliasSummary[];
  readonly sources: readonly PageSourceSummary[];
  readonly pageType: PageType;
  readonly indexability: PageIndexability;
  readonly httpStatus?: number;
  readonly canonicalTarget?: string;
  readonly robots?: string;
  readonly title?: string;
  readonly description?: string;
  readonly h1?: string;
  readonly language?: string;
  readonly template?: string;
  readonly contentStatus?: PageContentStatus;
  readonly ownerId?: string;
  readonly priority: number;
  readonly publishedAt?: string;
  readonly crawledAt?: string;
  readonly analyticsMetrics: Readonly<Record<string, number>>;
  readonly notes?: string;
  readonly assignedKeywordCount: number;
  readonly assignedClusterCount: number;
  readonly lifecycleStatus: PageLifecycleStatus;
  readonly version: number;
  readonly createdBy?: string;
  readonly updatedBy?: string;
  readonly archivedBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export interface ProjectPageListQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly pageType?: PageType;
  readonly indexability?: PageIndexability;
  readonly lifecycleStatus?: PageLifecycleStatus;
}

export interface ProjectPageCollection {
  readonly pages: readonly ProjectPageSummary[];
  readonly nextCursor?: string;
}

export const pageMutationRestrictions = [
  "NONE",
  "MISSING_PERMISSION",
  "WORKSPACE_READ_ONLY",
  "PROJECT_ARCHIVED"
] as const;

export type PageMutationRestriction =
  (typeof pageMutationRestrictions)[number];

export interface ProjectPageAccess {
  readonly canManage: boolean;
  readonly mutationRestriction: PageMutationRestriction;
}

export interface ProjectPageSettings extends ProjectPageCollection {
  readonly access: ProjectPageAccess;
}

export interface ProjectPageInput {
  readonly url: string;
  readonly aliases: readonly string[];
  readonly pageType: PageType;
  readonly indexability: PageIndexability;
  readonly httpStatus?: number;
  readonly canonicalTarget?: string;
  readonly robots?: string;
  readonly title?: string;
  readonly description?: string;
  readonly h1?: string;
  readonly language?: string;
  readonly template?: string;
  readonly contentStatus?: PageContentStatus;
  readonly ownerId?: string;
  readonly priority: number;
  readonly publishedAt?: string;
  readonly notes?: string;
}

export type CreateProjectPageInput = ProjectPageInput;
export type UpdateProjectPageInput = ProjectPageInput;

export interface InternalCreateProjectPageInput
  extends CreateProjectPageInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

export interface InternalUpdateProjectPageInput
  extends UpdateProjectPageInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalChangeProjectPageStatusInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}
