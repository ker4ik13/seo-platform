import type {
  RankEstimateEntitlementStatus,
  RankEstimateQuota
} from "./rank-estimates.js";
import type {
  TrackingDevice,
  TrackingDomainMatchRule
} from "./tracking-contexts.js";

export interface CreateRankRunInput {
  readonly estimateId: string;
}

export const rankJobStatuses = [
  "PREPARING",
  "QUEUED",
  "RUNNING",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "FAILED",
  "ACTION_REQUIRED"
] as const;

export type RankJobStatus = (typeof rankJobStatuses)[number];

/**
 * Public, stable stages. Internal leases, provider request IDs and retry
 * bookkeeping must never be projected into this vocabulary.
 */
export const rankJobStages = [
  "PREPARING_SCOPE",
  "WAITING_FOR_QUEUE",
  "WAITING_EXECUTION_GRANT",
  "READY_TO_SUBMIT",
  "SUBMITTING",
  "WAITING_PROVIDER",
  "FETCHING_RESULT",
  "PERSISTING_RESULT",
  "FINALIZING",
  "SUBMIT_OUTCOME_UNKNOWN",
  "FINISHED"
] as const;

export type RankJobStage = (typeof rankJobStages)[number];

export const rankJobFailureCodes = [
  "ESTIMATE_STALE",
  "EXECUTION_GRANT_DENIED",
  "PROVIDER_AUTHENTICATION_FAILED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TEMPORARY_FAILURE",
  "PROVIDER_RESPONSE_INVALID",
  "PERSISTENCE_FAILED",
  "INTERNAL_ERROR",
  "SUBMIT_OUTCOME_UNKNOWN"
] as const;

export type RankJobFailureCode = (typeof rankJobFailureCodes)[number];

export interface RankJobProgress {
  /**
   * Non-negative decimal integer. It must never exceed total.
   */
  readonly current: string;
  /**
   * Non-negative decimal integer sealed from the immutable manifest.
   */
  readonly total: string;
  readonly unit: "KEYWORD";
}

export interface RankJobResultSummary {
  /**
   * All values are non-negative decimal integers. persistedCount equals
   * foundCount + notFoundCount and must not exceed pairCount.
   */
  readonly pairCount: string;
  readonly persistedCount: string;
  readonly foundCount: string;
  readonly notFoundCount: string;
  readonly failedCount: string;
  readonly submitOutcomeUnknownCount: string;
}

export interface RankJobFailureSummary {
  readonly code: RankJobFailureCode;
}

/**
 * Redacted browser/API projection of a manual rank Job.
 *
 * Credential/binding/material IDs, project domain, keyword text, ranking
 * URLs, provider request IDs and provider/raw payloads are deliberately
 * absent. A consumer must build the response through redactRankJobSummary,
 * not serialize an internal Job record directly.
 */
interface RankJobSummaryBase {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly trackingContextId: string;
  readonly type: "MANUAL_RANK_CHECK";
  readonly provider: "ARSENKIN";
  readonly operation: "POSITIONS";
  readonly credentialMode: "BYOK_API_KEY";
  readonly progress: RankJobProgress;
  readonly platformChargeMicro: "0";
  readonly billingCurrency: string;
  readonly createdAt: string;
}

type RankJobActiveStage = Exclude<
  RankJobStage,
  | "PREPARING_SCOPE"
  | "WAITING_FOR_QUEUE"
  | "SUBMIT_OUTCOME_UNKNOWN"
  | "FINISHED"
>;

type RankJobCancellableStage = Exclude<
  RankJobStage,
  "SUBMIT_OUTCOME_UNKNOWN" | "FINISHED"
>;

interface RankJobNonterminalFields {
  readonly result?: never;
  readonly failure?: never;
  readonly finishedAt?: never;
}

interface RankJobTerminalFields {
  readonly finishedAt: string;
  readonly queuedAt?: string;
  readonly startedAt?: string;
}

export type RankJobSummary =
  | (RankJobSummaryBase &
      RankJobNonterminalFields & {
        readonly status: "PREPARING";
        readonly stage: "PREPARING_SCOPE";
        readonly queuedAt?: never;
        readonly startedAt?: never;
      })
  | (RankJobSummaryBase &
      RankJobNonterminalFields & {
        readonly status: "QUEUED";
        readonly stage: "WAITING_FOR_QUEUE";
        readonly queuedAt: string;
        readonly startedAt?: never;
      })
  | (RankJobSummaryBase &
      RankJobNonterminalFields & {
        readonly status: "RUNNING";
        readonly stage: RankJobActiveStage;
        readonly queuedAt: string;
        readonly startedAt: string;
      })
  | (RankJobSummaryBase &
      RankJobNonterminalFields & {
        readonly status: "CANCEL_REQUESTED";
        readonly stage: RankJobCancellableStage;
        readonly queuedAt?: string;
        readonly startedAt?: string;
      })
  | (RankJobSummaryBase &
      RankJobTerminalFields & {
        readonly status: "CANCELLED";
        readonly stage: "FINISHED";
        readonly result?: RankJobResultSummary;
        readonly failure?: never;
      })
  | (RankJobSummaryBase &
      RankJobTerminalFields & {
        readonly status: "PARTIALLY_COMPLETED" | "COMPLETED";
        readonly stage: "FINISHED";
        readonly result: RankJobResultSummary;
        readonly failure?: never;
      })
  | (RankJobSummaryBase &
      RankJobTerminalFields & {
        readonly status: "FAILED";
        readonly stage: "FINISHED";
        readonly result?: RankJobResultSummary;
        readonly failure: {
          readonly code: Exclude<
            RankJobFailureCode,
            "SUBMIT_OUTCOME_UNKNOWN"
          >;
        };
      })
  | (RankJobSummaryBase &
      RankJobTerminalFields & {
        readonly status: "ACTION_REQUIRED";
        readonly stage: "SUBMIT_OUTCOME_UNKNOWN";
        readonly result: RankJobResultSummary;
        readonly failure: {
          readonly code: "SUBMIT_OUTCOME_UNKNOWN";
        };
      });

/**
 * Rebuilds the public DTO from an allowlist so accidental private properties
 * on a structurally compatible runtime object cannot cross the API boundary.
 * It also enforces the public lifecycle matrix. Validation of identifiers,
 * timestamps, decimal counts and cross-field totals remains the owning
 * service's duty.
 */
export function redactRankJobSummary(input: RankJobSummary): RankJobSummary {
  if (
    input.type !== "MANUAL_RANK_CHECK" ||
    input.provider !== "ARSENKIN" ||
    input.operation !== "POSITIONS" ||
    input.credentialMode !== "BYOK_API_KEY" ||
    input.progress.unit !== "KEYWORD" ||
    input.platformChargeMicro !== "0"
  ) {
    return invalidRankJobLifecycle();
  }

  const base: RankJobSummaryBase = {
    id: input.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    trackingContextId: input.trackingContextId,
    type: input.type,
    provider: input.provider,
    operation: input.operation,
    credentialMode: input.credentialMode,
    progress: {
      current: input.progress.current,
      total: input.progress.total,
      unit: input.progress.unit
    },
    platformChargeMicro: input.platformChargeMicro,
    billingCurrency: input.billingCurrency,
    createdAt: input.createdAt
  };

  switch (input.status) {
    case "PREPARING": {
      if (
        input.stage !== "PREPARING_SCOPE" ||
        input.queuedAt !== undefined ||
        input.startedAt !== undefined ||
        input.finishedAt !== undefined ||
        input.result !== undefined ||
        input.failure !== undefined
      ) {
        return invalidRankJobLifecycle();
      }
      return {
        ...base,
        status: input.status,
        stage: input.stage
      };
    }
    case "QUEUED": {
      if (
        input.stage !== "WAITING_FOR_QUEUE" ||
        input.queuedAt === undefined ||
        input.startedAt !== undefined ||
        input.finishedAt !== undefined ||
        input.result !== undefined ||
        input.failure !== undefined
      ) {
        return invalidRankJobLifecycle();
      }
      return {
        ...base,
        status: input.status,
        stage: input.stage,
        queuedAt: input.queuedAt
      };
    }
    case "RUNNING": {
      if (
        !isActiveRankJobStage(input.stage) ||
        input.queuedAt === undefined ||
        input.startedAt === undefined ||
        input.finishedAt !== undefined ||
        input.result !== undefined ||
        input.failure !== undefined
      ) {
        return invalidRankJobLifecycle();
      }
      return {
        ...base,
        status: input.status,
        stage: input.stage,
        queuedAt: input.queuedAt,
        startedAt: input.startedAt
      };
    }
    case "CANCEL_REQUESTED": {
      if (
        !isCancellableRankJobStage(input.stage) ||
        input.finishedAt !== undefined ||
        input.result !== undefined ||
        input.failure !== undefined
      ) {
        return invalidRankJobLifecycle();
      }
      return {
        ...base,
        status: input.status,
        stage: input.stage,
        ...rankJobExecutionTimes(input)
      };
    }
    case "CANCELLED": {
      if (
        input.stage !== "FINISHED" ||
        input.finishedAt === undefined ||
        input.failure !== undefined
      ) {
        return invalidRankJobLifecycle();
      }
      return {
        ...base,
        status: input.status,
        stage: input.stage,
        ...(input.result === undefined
          ? {}
          : { result: redactedRankJobResult(input.result) }),
        ...rankJobExecutionTimes(input),
        finishedAt: input.finishedAt
      };
    }
    case "PARTIALLY_COMPLETED":
    case "COMPLETED": {
      if (
        input.stage !== "FINISHED" ||
        input.result === undefined ||
        input.finishedAt === undefined ||
        input.failure !== undefined
      ) {
        return invalidRankJobLifecycle();
      }
      return {
        ...base,
        status: input.status,
        stage: input.stage,
        result: redactedRankJobResult(input.result),
        ...rankJobExecutionTimes(input),
        finishedAt: input.finishedAt
      };
    }
    case "FAILED": {
      const failureCode = (
        input.failure as RankJobFailureSummary | undefined
      )?.code;
      if (
        input.stage !== "FINISHED" ||
        input.finishedAt === undefined ||
        !isRankJobFailureCode(failureCode) ||
        failureCode === "SUBMIT_OUTCOME_UNKNOWN"
      ) {
        return invalidRankJobLifecycle();
      }
      return {
        ...base,
        status: input.status,
        stage: input.stage,
        ...(input.result === undefined
          ? {}
          : { result: redactedRankJobResult(input.result) }),
        failure: { code: failureCode },
        ...rankJobExecutionTimes(input),
        finishedAt: input.finishedAt
      };
    }
    case "ACTION_REQUIRED": {
      if (
        input.stage !== "SUBMIT_OUTCOME_UNKNOWN" ||
        input.result === undefined ||
        input.finishedAt === undefined ||
        input.failure?.code !== "SUBMIT_OUTCOME_UNKNOWN"
      ) {
        return invalidRankJobLifecycle();
      }
      return {
        ...base,
        status: input.status,
        stage: input.stage,
        result: redactedRankJobResult(input.result),
        failure: { code: input.failure.code },
        ...rankJobExecutionTimes(input),
        finishedAt: input.finishedAt
      };
    }
  }

  return invalidRankJobLifecycle();
}

const ACTIVE_RANK_JOB_STAGES: ReadonlySet<RankJobStage> = new Set([
  "WAITING_EXECUTION_GRANT",
  "READY_TO_SUBMIT",
  "SUBMITTING",
  "WAITING_PROVIDER",
  "FETCHING_RESULT",
  "PERSISTING_RESULT",
  "FINALIZING"
]);

const CANCELLABLE_RANK_JOB_STAGES: ReadonlySet<RankJobStage> = new Set([
  "PREPARING_SCOPE",
  "WAITING_FOR_QUEUE",
  ...ACTIVE_RANK_JOB_STAGES
]);

const RANK_JOB_FAILURE_CODES: ReadonlySet<string> = new Set(
  rankJobFailureCodes
);

function isActiveRankJobStage(
  value: RankJobStage
): value is RankJobActiveStage {
  return ACTIVE_RANK_JOB_STAGES.has(value);
}

function isCancellableRankJobStage(
  value: RankJobStage
): value is RankJobCancellableStage {
  return CANCELLABLE_RANK_JOB_STAGES.has(value);
}

function isRankJobFailureCode(value: unknown): value is RankJobFailureCode {
  return typeof value === "string" && RANK_JOB_FAILURE_CODES.has(value);
}

function redactedRankJobResult(
  input: RankJobResultSummary
): RankJobResultSummary {
  return {
    pairCount: input.pairCount,
    persistedCount: input.persistedCount,
    foundCount: input.foundCount,
    notFoundCount: input.notFoundCount,
    failedCount: input.failedCount,
    submitOutcomeUnknownCount: input.submitOutcomeUnknownCount
  };
}

function rankJobExecutionTimes(input: {
  readonly queuedAt?: string;
  readonly startedAt?: string;
}): {
  readonly queuedAt?: string;
  readonly startedAt?: string;
} {
  return {
    ...(input.queuedAt === undefined ? {} : { queuedAt: input.queuedAt }),
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt })
  };
}

function invalidRankJobLifecycle(): never {
  throw new TypeError("Invalid rank job lifecycle");
}

/**
 * Authoritative Platform API projection. The browser supplies only
 * estimateId; lifecycle, tenant and domain data are loaded server-side.
 */
export interface InternalRankRunProjectSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly domain: string;
  readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  readonly version: number;
}

/**
 * Point-in-time authorization evidence for creation. It is not an execution
 * grant: each new provider submit must obtain a fresh one-time grant.
 */
export interface InternalRankRunAccessSnapshot {
  readonly workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
  readonly membershipId: string;
  readonly membershipVersion: number;
  readonly canRunRanking: boolean;
  readonly entitlementStatus: RankEstimateEntitlementStatus;
  readonly quota: RankEstimateQuota;
}

export interface InternalCreateRankRunInput extends CreateRankRunInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly project: InternalRankRunProjectSnapshot;
  readonly access: InternalRankRunAccessSnapshot;
  readonly billingCurrency: string;
}

export interface RankManifestHash {
  readonly algorithm: "SHA_256";
  /**
   * Lowercase 64-character hexadecimal SHA-256 value. "Canonical JSON" in
   * every rank hash contract means RFC 8785 JCS encoded as UTF-8; producers
   * and verifiers must use one shared implementation of that recipe.
   */
  readonly value: string;
}

/**
 * Provider-neutral semantics sealed before provider execution. The adapter
 * may map these values only through providerMappingVersion; it must not
 * silently drop country, region, language, safe search or domain matching.
 */
export interface InternalRankExecutionParameters {
  readonly searchEngine: "GOOGLE";
  readonly countryCode: string;
  readonly regionCode?: string;
  readonly language: string;
  readonly device: TrackingDevice;
  readonly depth: 30;
  readonly domainMatchRule: TrackingDomainMatchRule;
  readonly safeSearch: boolean;
  readonly format: "SIMPLE";
  readonly rawSerp: false;
  readonly fallbackMode: "NONE";
  readonly providerMappingVersion: string;
}

export interface InternalRankManifestEstimateSeal {
  readonly trackingContextId: string;
  readonly contextVersion: number;
  readonly configurationVersion: number;
  readonly configurationHash: RankManifestHash;
  readonly semanticScopeHash: RankManifestHash;
  readonly scopeHash: RankManifestHash;
  /**
   * Exact non-negative decimal integer from 1 through 1,000.
   */
  readonly pairCount: string;
}

/**
 * Jobs asks SEO Data to atomically re-check the estimate scope and seal it.
 * Any project/context/configuration/scope drift must fail as ESTIMATE_STALE;
 * the service must never partially seal a manifest.
 */
export interface InternalSealRankManifestInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly estimateId: string;
  readonly provider: "ARSENKIN";
  readonly operation: "POSITIONS";
  readonly project: InternalRankRunProjectSnapshot;
  readonly estimate: InternalRankManifestEstimateSeal;
  readonly execution: InternalRankExecutionParameters;
  readonly retention: {
    readonly normalizedRankHistory: "LONG_TERM";
    readonly rawSerp: "NOT_COLLECTED";
  };
}

/**
 * Immutable manifest header. chunkCount and pairCount are exact decimal
 * integers, every chunk except the last has 250 entries, and manifestHash
 * covers the header plus ordered chunk hashes.
 */
export interface InternalRankManifestSeal {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly estimateId: string;
  readonly trackingContextId: string;
  readonly provider: "ARSENKIN";
  readonly operation: "POSITIONS";
  readonly project: InternalRankRunProjectSnapshot;
  readonly contextVersion: number;
  readonly configurationVersion: number;
  readonly configurationHash: RankManifestHash;
  readonly semanticScopeHash: RankManifestHash;
  readonly scopeHash: RankManifestHash;
  /**
   * Canonicalization recipe for both hashes. Version changes are additive
   * and old manifests retain their original recipe.
   */
  readonly hashSchemaVersion: "rank-manifest@1";
  /**
   * SHA-256 over canonical JSON under hashSchemaVersion. The preimage contains
   * the complete immutable header (including run-specific IDs, sealedAt and
   * deduplicationHash) plus ordered chunk hashes, and excludes only
   * manifestHash itself.
   */
  readonly manifestHash: RankManifestHash;
  /**
   * Semantic active-run deduplication hash. It covers tenant/project,
   * project domain/version, trackingContextId/contextVersion,
   * configurationVersion/configurationHash, semanticScopeHash/scopeHash,
   * provider execution parameters, retention and ordered
   * keywordId+keywordVersion+keywordTextHash+language entries. It excludes
   * job/estimate/manifest/entry/assignment IDs, actor and timestamps, so a
   * new idempotency key cannot bypass active
   * project+provider+deduplicationHash protection.
   */
  readonly deduplicationHash: RankManifestHash;
  readonly pairCount: string;
  readonly chunkCount: string;
  readonly chunkSize: "250";
  readonly execution: InternalRankExecutionParameters;
  readonly retention: {
    readonly normalizedRankHistory: "LONG_TERM";
    readonly rawSerp: "NOT_COLLECTED";
  };
  readonly status: "SEALED";
  readonly sealedAt: string;
}

export interface InternalGetRankManifestChunkInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly manifestId: string;
  /**
   * Zero-based integer lower than the sealed chunkCount.
   */
  readonly chunkIndex: number;
}

/**
 * Secret-bearing internal row. keywordText and project domain must never be
 * copied to a queue payload, public DTO, log, metric, event or error.
 */
export interface InternalRankManifestEntry {
  readonly id: string;
  readonly sequence: number;
  readonly assignmentId: string;
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly keywordText: string;
  readonly keywordTextHash: RankManifestHash;
  readonly language: string;
}

export interface InternalRankManifestChunk {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly manifestId: string;
  readonly chunkIndex: number;
  readonly hashSchemaVersion: "rank-manifest-chunk@1";
  /**
   * SHA-256 over canonical JSON under hashSchemaVersion containing
   * manifestId, chunk index and the ordered complete entry DTO, excluding
   * only chunkHash itself. Semantic deduplication is calculated separately
   * and must not reuse this run-specific hash.
   */
  readonly chunkHash: RankManifestHash;
  /**
   * Ordered by sequence, unique by entry/keyword and bounded to 250 rows.
   */
  readonly entries: readonly InternalRankManifestEntry[];
}

export const normalizedRankResultTypes = ["ORGANIC"] as const;

export type NormalizedRankResultType =
  (typeof normalizedRankResultTypes)[number];

export const normalizedRankDataQualityFlags = [
  "PROVIDER_OBSERVED_AT_UNAVAILABLE",
  "ABSOLUTE_POSITION_UNAVAILABLE",
  "PIXEL_POSITION_UNAVAILABLE",
  "TITLE_UNAVAILABLE",
  "SNIPPET_UNAVAILABLE"
] as const;

export type NormalizedRankDataQualityFlag =
  (typeof normalizedRankDataQualityFlags)[number];

interface InternalNormalizedRankResultBase {
  readonly manifestEntryId: string;
  readonly keywordId: string;
  readonly dataQualityFlags: readonly NormalizedRankDataQualityFlag[];
}

/**
 * position is an integer from 1 through the sealed depth (30). Optional
 * absolute/pixel positions are non-negative integers when present.
 */
export interface InternalNormalizedRankFoundResult
  extends InternalNormalizedRankResultBase {
  readonly found: true;
  readonly position: number;
  readonly absolutePosition?: number;
  readonly pixelPosition?: number;
  readonly rankingUrl: string;
  readonly normalizedRankingUrl: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly resultType: "ORGANIC";
  readonly serpFeatures: readonly [];
}

/**
 * A valid "not found" observation is not an error and cannot carry position,
 * URL or result metadata.
 */
export interface InternalNormalizedRankNotFoundResult
  extends InternalNormalizedRankResultBase {
  readonly found: false;
  readonly position: null;
  readonly absolutePosition?: never;
  readonly pixelPosition?: never;
  readonly rankingUrl?: never;
  readonly normalizedRankingUrl?: never;
  readonly title?: never;
  readonly snippet?: never;
  readonly resultType?: never;
  readonly serpFeatures?: never;
}

export type InternalNormalizedRankResult =
  | InternalNormalizedRankFoundResult
  | InternalNormalizedRankNotFoundResult;

/**
 * ingestEnvelopeHash is calculated from the complete canonical command
 * envelope under schemaVersion, excluding only the hash field itself. It
 * therefore covers tenant/job/item/manifest/chunk IDs, actor, provider,
 * providerRequestId, connectorVersion, observedAt and ordered normalized
 * results, but never raw provider bytes. Results are ordered by the sealed
 * manifest sequence; every dataQualityFlags array is sorted by the finite
 * normalizedRankDataQualityFlags vocabulary before hashing. Results must be
 * a complete one-to-one projection of the referenced manifest chunk:
 * missing and duplicate rows are rejected.
 */
export interface InternalIngestRankChunkInput {
  readonly schemaVersion: "rank-ingest@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly manifestId: string;
  readonly chunkIndex: number;
  readonly provider: "ARSENKIN";
  readonly operation: "POSITIONS";
  /**
   * Internal traceability only; it must never cross public/event/log
   * boundaries.
   */
  readonly providerRequestId: string;
  readonly connectorVersion: string;
  /**
   * One authoritative ISO timestamp shared by every observation in the
   * provider result.
   */
  readonly observedAt: string;
  readonly ingestEnvelopeHash: RankManifestHash;
  readonly results: readonly InternalNormalizedRankResult[];
}

/**
 * Exact replay returns the same receipt. The same manifest/chunk identity
 * with another hash is an idempotency conflict. currentSkippedCount records
 * observations that were older than the existing current projection.
 */
export interface InternalRankChunkIngestReceipt {
  readonly schemaVersion: "rank-ingest@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly manifestId: string;
  readonly chunkIndex: number;
  readonly providerRequestId: string;
  readonly connectorVersion: string;
  readonly observedAt: string;
  readonly ingestEnvelopeHash: RankManifestHash;
  readonly status: "APPLIED";
  readonly persistedCount: string;
  readonly foundCount: string;
  readonly notFoundCount: string;
  readonly currentUpdatedCount: string;
  readonly currentSkippedCount: string;
  readonly appliedAt: string;
}

export const rankCheckFinalStatuses = [
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "CANCELLED",
  "FAILED",
  "ACTION_REQUIRED"
] as const;

export type RankCheckFinalStatus = (typeof rankCheckFinalStatuses)[number];

/**
 * SEO Data derives every count from sealed manifest and ingest receipts; the
 * caller supplies only the intended terminal status and tenant identity.
 * Exact replay of job+manifest+status returns the same receipt/outbox;
 * another status for an already finalized manifest is a conflict.
 * Finalize and ingest serialize on one manifest lock. Finalization closes the
 * manifest before writing its receipt/outbox, and any later ingest is
 * rejected, so terminal counts cannot change after publication.
 * COMPLETED is valid only when persistedCount=pairCount.
 * PARTIALLY_COMPLETED requires 0<persistedCount<pairCount.
 * ACTION_REQUIRED preserves SUBMIT_OUTCOME_UNKNOWN without emitting a
 * completed event. CANCELLED/FAILED may finalize after the manifest is
 * sealed but before any result/chunk persistence; their derived result
 * counts are then zero. A failure before manifest seal is finalized only in
 * Jobs and must not call this SEO Data finalization boundary.
 */
export interface InternalFinalizeRankCheckInput {
  readonly schemaVersion: "rank-finalize@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly manifestId: string;
  readonly status: RankCheckFinalStatus;
}

export interface InternalRankCheckFinalizationReceipt {
  readonly schemaVersion: "rank-finalize@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly manifestId: string;
  readonly requestHash: RankManifestHash;
  readonly trackingContextId: string;
  readonly configurationVersion: number;
  readonly status: RankCheckFinalStatus;
  readonly pairCount: string;
  readonly persistedCount: string;
  readonly foundCount: string;
  readonly notFoundCount: string;
  readonly missingCount: string;
  readonly finalizedAt: string;
}
