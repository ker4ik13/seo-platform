import {
  arsenkinClusteringKeywordLimit,
  clusteringProposalConflictReasons,
  clusteringProposalItemStates,
  clusteringProposalStatuses,
  type ClusteringProposalApplyResult,
  type ClusteringProposalSummary,
  type InternalClusteringProposalResult
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

export function scopedInternalClusteringProposalResult(
  value: unknown,
  workspaceId: string,
  projectId: string,
  jobId: string,
  limit: number,
  cursor?: string
): InternalClusteringProposalResult {
  const input = exact(value, ["workspaceId", "projectId", "jobId", "clusters", "rows", "page"], ["proposal"]);
  const page = exact(input.page, ["hasNext"], ["nextCursor"]);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    input.jobId !== jobId ||
    !Array.isArray(input.clusters) ||
    input.clusters.length > arsenkinClusteringKeywordLimit ||
    !Array.isArray(input.rows) ||
    input.rows.length > limit ||
    typeof page.hasNext !== "boolean" ||
    (page.hasNext && (typeof page.nextCursor !== "string" || input.rows.length !== limit)) ||
    (!page.hasNext && page.nextCursor !== undefined)
  ) invalid();
  const sequences = new Set<number>();
  const keywordIds = new Set<string>();
  const clusterIds = new Set<string>();
  const clusterSequences = new Set<number>();
  const clusters = input.clusters.map((candidate) => {
    const cluster = proposalCluster(candidate);
    if (clusterIds.has(cluster.id) || clusterSequences.has(cluster.sequence)) invalid();
    clusterIds.add(cluster.id);
    clusterSequences.add(cluster.sequence);
    return cluster;
  });
  const clustersById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const rows = input.rows.map((candidate) => {
    const row = exact(
      candidate,
      ["sequence", "keywordId", "keyword", "state"],
      [
        "conflictReason", "currentClusterName", "proposedCluster", "frequency", "exactFrequency",
        "aggregatorsPercent", "toponym", "geoDependent"
      ]
    );
    const sequence = integer(row.sequence, 0, arsenkinClusteringKeywordLimit - 1);
    const keywordId = uuid(row.keywordId);
    if (
      sequences.has(sequence) ||
      keywordIds.has(keywordId) ||
      typeof row.keyword !== "string" ||
      row.keyword.length < 1 ||
      row.keyword.length > 2_000
    ) invalid();
    sequences.add(sequence);
    keywordIds.add(keywordId);
    const proposedCluster = row.proposedCluster === undefined
      ? undefined
      : proposalCluster(row.proposedCluster);
    if (
      proposedCluster &&
      JSON.stringify(clustersById.get(proposedCluster.id)) !== JSON.stringify(proposedCluster)
    ) invalid();
    return {
      sequence,
      keywordId,
      keyword: row.keyword,
      state: member(row.state, clusteringProposalItemStates),
      ...(row.conflictReason === undefined
        ? {}
        : { conflictReason: member(row.conflictReason, clusteringProposalConflictReasons) }),
      ...(row.currentClusterName === undefined
        ? {}
        : { currentClusterName: bounded(row.currentClusterName, 255) }),
      ...(proposedCluster ? { proposedCluster } : {}),
      ...optionalDecimal(row.frequency, "frequency"),
      ...optionalDecimal(row.exactFrequency, "exactFrequency"),
      ...(row.aggregatorsPercent === undefined
        ? {}
        : { aggregatorsPercent: finite(row.aggregatorsPercent, 0, 100) }),
      ...(row.toponym === undefined ? {} : { toponym: bounded(row.toponym, 255) }),
      ...(row.geoDependent === undefined ? {} : { geoDependent: boolean(row.geoDependent) })
    };
  });
  const firstSequence = cursor === undefined ? 0 : Number(cursor) + 1;
  if (
    rows.some((row, index) => row.sequence !== firstSequence + index) ||
    (page.hasNext && page.nextCursor !== String(rows.at(-1)?.sequence))
  ) invalid();
  const proposal = input.proposal === undefined
    ? undefined
    : proposalSummary(input.proposal, jobId);
  if (
    (!proposal && clusters.length > 0) ||
    (proposal && (
      proposal.clusterCount !== clusters.length ||
      clusters.reduce((total, cluster) => total + cluster.keywordCount, 0) +
        proposal.unclusteredCount !== proposal.keywordCount
    ))
  ) invalid();
  return {
    workspaceId,
    projectId,
    jobId,
    ...(proposal ? { proposal } : {}),
    clusters,
    rows,
    page: {
      hasNext: page.hasNext,
      ...(typeof page.nextCursor === "string" ? { nextCursor: page.nextCursor } : {})
    }
  };
}

export function scopedClusteringProposalApplyResult(
  value: unknown,
  jobId: string
): ClusteringProposalApplyResult {
  const input = exact(value, [
    "proposal",
    "createdClusterCount",
    "createdGroupCount",
    "appliedKeywordCount",
    "skippedKeywordCount",
    "conflictedKeywordCount",
    "semanticVersionIds"
  ]);
  const semanticVersionIds = uuids(input.semanticVersionIds, arsenkinClusteringKeywordLimit);
  return {
    proposal: proposalSummary(input.proposal, jobId),
    createdClusterCount: integer(input.createdClusterCount, 0, arsenkinClusteringKeywordLimit),
    createdGroupCount: integer(input.createdGroupCount, 0, arsenkinClusteringKeywordLimit),
    appliedKeywordCount: integer(input.appliedKeywordCount, 0, arsenkinClusteringKeywordLimit),
    skippedKeywordCount: integer(input.skippedKeywordCount, 0, arsenkinClusteringKeywordLimit),
    conflictedKeywordCount: integer(input.conflictedKeywordCount, 0, arsenkinClusteringKeywordLimit),
    semanticVersionIds
  };
}

export function scopedClusteringProposalSummary(
  value: unknown,
  jobId: string
): ClusteringProposalSummary {
  return proposalSummary(value, jobId);
}

function proposalSummary(value: unknown, jobId: string): ClusteringProposalSummary {
  const input = exact(
    value,
    [
      "id", "jobId", "status", "keywordCount", "clusterCount", "unclusteredCount",
      "readyCount", "protectedCount", "conflictedCount", "appliedKeywordCount",
      "createdGroupCount", "semanticVersionIds", "version", "createdAt", "updatedAt"
    ],
    ["appliedAt", "rejectedAt"]
  );
  if (uuid(input.jobId) !== jobId) invalid();
  return {
    id: uuid(input.id),
    jobId,
    status: member(input.status, clusteringProposalStatuses),
    keywordCount: integer(input.keywordCount, 1, arsenkinClusteringKeywordLimit),
    clusterCount: integer(input.clusterCount, 0, arsenkinClusteringKeywordLimit),
    unclusteredCount: integer(input.unclusteredCount, 0, arsenkinClusteringKeywordLimit),
    readyCount: integer(input.readyCount, 0, arsenkinClusteringKeywordLimit),
    protectedCount: integer(input.protectedCount, 0, arsenkinClusteringKeywordLimit),
    conflictedCount: integer(input.conflictedCount, 0, arsenkinClusteringKeywordLimit),
    appliedKeywordCount: integer(input.appliedKeywordCount, 0, arsenkinClusteringKeywordLimit),
    createdGroupCount: integer(input.createdGroupCount, 0, arsenkinClusteringKeywordLimit),
    semanticVersionIds: uuids(input.semanticVersionIds, arsenkinClusteringKeywordLimit),
    version: integer(input.version, 1, Number.MAX_SAFE_INTEGER),
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
    ...(input.appliedAt === undefined ? {} : { appliedAt: timestamp(input.appliedAt) }),
    ...(input.rejectedAt === undefined ? {} : { rejectedAt: timestamp(input.rejectedAt) })
  };
}

function proposalCluster(value: unknown) {
  const input = exact(
    value,
    ["id", "sequence", "name", "keywordCount", "currentClusterKeywordCount", "topUrls"],
    ["topUrl", "frequencySum", "mainPageCount"]
  );
  if (!Array.isArray(input.topUrls) || input.topUrls.length > 100) invalid();
  const topUrls = input.topUrls.map((candidate) => {
    const topUrl = exact(candidate, ["url"], ["overlapCount"]);
    return {
      url: url(topUrl.url),
      ...(topUrl.overlapCount === undefined
        ? {}
        : { overlapCount: integer(topUrl.overlapCount, 0, arsenkinClusteringKeywordLimit) })
    };
  });
  if (new Set(topUrls.map(({ url: value }) => value)).size !== topUrls.length) invalid();
  const keywordCount = integer(input.keywordCount, 1, arsenkinClusteringKeywordLimit);
  const currentClusterKeywordCount = integer(
    input.currentClusterKeywordCount,
    0,
    keywordCount
  );
  return {
    id: uuid(input.id),
    sequence: integer(input.sequence, 0, arsenkinClusteringKeywordLimit - 1),
    name: bounded(input.name, 255),
    keywordCount,
    currentClusterKeywordCount,
    ...(input.topUrl === undefined ? {} : { topUrl: url(input.topUrl) }),
    topUrls,
    ...optionalDecimal(input.frequencySum, "frequencySum"),
    ...(input.mainPageCount === undefined
      ? {}
      : { mainPageCount: integer(input.mainPageCount, 0, arsenkinClusteringKeywordLimit) })
  };
}

function exact(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const input = value as Readonly<Record<string, unknown>>;
  if (
    required.some((key) => !(key in input)) ||
    Object.keys(input).some((key) => !required.includes(key) && !optional.includes(key))
  ) invalid();
  return input;
}

function optionalDecimal(value: unknown, key: string): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,18})$/u.test(value)) invalid();
  return { [key]: value };
}

function member<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as Values[number];
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) invalid();
  return value.toLowerCase();
}

function uuids(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  const result = value.map(uuid);
  if (new Set(result).size !== result.length) invalid();
  return result;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid();
  return Number(value);
}

function finite(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) invalid();
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function bounded(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) invalid();
  return value;
}

function url(value: unknown): string {
  if (typeof value !== "string" || value.length > 8_192 || !URL.canParse(value)) invalid();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid();
  return value;
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO data returned an invalid clustering proposal response",
    retryable: true
  });
}
