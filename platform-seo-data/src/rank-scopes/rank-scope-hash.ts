import {
  canonicalJsonSha256,
  utf8Sha256
} from "@seo-platform/contracts/canonical-json";

export interface RankScopeHashContext {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly status: string;
}

export interface RankScopeHashConfiguration {
  readonly configurationVersion: number;
  readonly configurationHash: string;
}

export interface RankScopeHashAssignment {
  readonly keywordId: string;
  readonly keyword: {
    readonly version: number;
    readonly textOriginal: string;
    readonly language: string;
  };
}

/**
 * Canonical semantic scope shared by provider-free estimate and immutable
 * manifest sealing. Keyword text is covered by a digest and never returned
 * by the estimate boundary.
 */
export function semanticRankScopeHash(
  context: RankScopeHashContext,
  configuration: RankScopeHashConfiguration,
  assignments: readonly RankScopeHashAssignment[]
): string {
  const orderedAssignments = [...assignments].sort((left, right) =>
    left.keywordId < right.keywordId
      ? -1
      : left.keywordId > right.keywordId
        ? 1
        : 0
  );
  const scope = {
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    trackingContextId: context.id,
    contextStatus: context.status,
    configurationVersion: configuration.configurationVersion,
    configurationHash: configuration.configurationHash,
    assignments: orderedAssignments.map((assignment) => ({
      keywordId: assignment.keywordId,
      keywordVersion: assignment.keyword.version,
      textOriginalHash: utf8Sha256(assignment.keyword.textOriginal),
      language: assignment.keyword.language
    }))
  };
  return canonicalJsonSha256("rank-estimate-scope.v1", scope);
}
