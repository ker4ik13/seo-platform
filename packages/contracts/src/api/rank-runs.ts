import { rankCommandKeywordLimit } from "./rank-policy.js";
import {
  type RankCollectionPurpose,
  type RankEstimateEntitlementStatus,
  type RankEstimateQuota,
  type RankSearchSource,
  type RankYandexLiveMode
} from "./rank-estimates.js";
import type {
  TrackingDevice,
  TrackingDomainMatchRule
} from "./tracking-contexts.js";
import type { JobCapacityEntitlement } from "./billing.js";
import type {
  ConnectorOperationAttemptSummary,
  ConnectorRoutingScope
} from "./integrations.js";

export interface CreateRankRunInput {
  readonly estimateId: string;
  /** Exact estimate amount explicitly confirmed by the caller. */
  readonly confirmedPlatformChargeMicro: string;
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

export const rankRuntimeDiagnosticStates = [
  "QUEUED",
  "REQUESTING",
  "WAITING_PROVIDER",
  "WAITING_NEXT_PAGE",
  "SAVING",
  "COMPLETED",
  "RETRY_WAIT",
  "FAILED"
] as const;

export type RankRuntimeDiagnosticState =
  (typeof rankRuntimeDiagnosticStates)[number];

export type RankRuntimeDiagnosticProduct =
  | "YANDEX_LIVE"
  | "YANDEX_TURBO"
  | "GOOGLE_LIVE"
  | "YANDEX_SEARCH_API";

export interface RankRuntimeDiagnosticPolicy {
  readonly product: RankRuntimeDiagnosticProduct;
  readonly concurrency: number;
  readonly requestsPerSecond: number;
}

export interface RankRuntimeDiagnosticTotals {
  readonly total: number;
  readonly prepared: number;
  /** Live database leases, including work waiting for an XMLStock HTTP permit. */
  readonly active: number;
  readonly waitingProvider: number;
  readonly completed: number;
  readonly failed: number;
}

/**
 * Safe live projection for one XMLStock keyword execution. Provider request
 * IDs, credential identities, raw payloads and physical worker names are not
 * exposed. `active` means a live database lease, not an in-flight HTTP call;
 * `lane` is a legacy synthetic display group, not a provider thread.
 */
export interface RankRuntimeDiagnosticEntry {
  readonly sequence: number;
  readonly keyword: string;
  readonly lane: number;
  readonly state: RankRuntimeDiagnosticState;
  readonly executionAttempt: number;
  readonly submitAttempts: number;
  readonly pollAttempts: number;
  readonly completedPages: number;
  readonly totalPages: number;
  readonly active: boolean;
  readonly nextActionAt?: string;
  readonly errorCode?: string;
  readonly updatedAt: string;
}

export interface RankRuntimeDiagnostics {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly policy: RankRuntimeDiagnosticPolicy;
  readonly totals: RankRuntimeDiagnosticTotals;
  readonly entries: readonly RankRuntimeDiagnosticEntry[];
}

/**
 * Restores the user-selected SERP source from the immutable provider mapping.
 * Legacy mapping versions did not distinguish XML/Search API from live SERP
 * and deliberately return undefined instead of guessing.
 */
export function rankSearchSourceFromProviderMappingVersion(
  searchEngine: "GOOGLE" | "YANDEX",
  providerMappingVersion: string
): RankSearchSource | undefined {
  if (
    searchEngine === "GOOGLE" &&
    (/^(?:arsenkin|xmlstock)-google-live@\d+$/u.test(providerMappingVersion) ||
      /^arsenkin-check-top-google-live@\d+$/u.test(providerMappingVersion))
  ) {
    return "LIVE";
  }
  if (
    searchEngine === "YANDEX" &&
    (/^(?:arsenkin|xmlstock)-yandex-live@\d+$/u.test(providerMappingVersion) ||
      /^arsenkin-check-top-yandex-live@\d+$/u.test(providerMappingVersion))
  ) {
    return "LIVE";
  }
  if (
    searchEngine === "YANDEX" &&
    (/^(?:arsenkin|xmlstock)-yandex-search-api@\d+$/u.test(
      providerMappingVersion
    ) ||
      /^arsenkin-check-top-yandex-xml@\d+$/u.test(providerMappingVersion))
  ) {
    return "SEARCH_API";
  }
  return undefined;
}

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
  "ESTIMATE_EXPIRED",
  "ESTIMATE_STALE",
  "EQUIVALENT_RUN_ACTIVE",
  "EXECUTION_GRANT_DENIED",
  "PROVIDER_AUTHENTICATION_FAILED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TEMPORARY_FAILURE",
  "PROVIDER_RESPONSE_INVALID",
  "PERSISTENCE_FAILED",
  "INTERNAL_ERROR",
  "SUBMIT_OUTCOME_UNKNOWN"
] as const;

/**
 * ESTIMATE_EXPIRED is final for the command and requires a newly calculated
 * estimate. EQUIVALENT_RUN_ACTIVE is also non-retryable: the caller should
 * open/wait for the active equivalent run and must not start another submit.
 */
export type RankJobFailureCode = (typeof rankJobFailureCodes)[number];

export const rankRunConflictReasons = [
  "EQUIVALENT_RUN_ACTIVE",
  "ESTIMATE_EXPIRED",
  "ESTIMATE_STALE",
  "EXECUTION_GRANT_DENIED"
] as const;

export type RankRunConflictReason =
  (typeof rankRunConflictReasons)[number];

/**
 * Safe Jobs -> Platform API -> Web conflict details. An equivalent run is
 * attachable through the ordinary tenant-scoped GET route; other conflicts
 * never carry a Job locator.
 */
export type RankRunConflictDetails =
  | {
      readonly reason: "EQUIVALENT_RUN_ACTIVE";
      readonly existingJobId: string;
    }
  | {
      readonly reason: Exclude<
        RankRunConflictReason,
        "EQUIVALENT_RUN_ACTIVE"
      >;
      readonly existingJobId?: never;
    };

/**
 * Internal and public conflict details deliberately share the same redacted
 * shape. No tenant, estimate, binding, credential or provider identifiers
 * are allowed.
 */
export type InternalRankRunConflictDetails = RankRunConflictDetails;

const RANK_RUN_CONFLICT_REASONS: ReadonlySet<string> = new Set(
  rankRunConflictReasons
);
const UUID_V7_LOWERCASE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Strict runtime parser/redactor for an error.details object.
 */
export function rankRunConflictDetails(
  value: unknown
): RankRunConflictDetails {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return invalidRankRunConflictDetails();
  }
  const record = value as Readonly<Record<string, unknown>>;
  const reason = record.reason;
  if (
    typeof reason !== "string" ||
    !RANK_RUN_CONFLICT_REASONS.has(reason)
  ) {
    return invalidRankRunConflictDetails();
  }

  if (reason === "EQUIVALENT_RUN_ACTIVE") {
    if (
      !hasExactEnumerableDataKeys(record, [
        "reason",
        "existingJobId"
      ]) ||
      typeof record.existingJobId !== "string" ||
      !UUID_V7_LOWERCASE_PATTERN.test(record.existingJobId)
    ) {
      return invalidRankRunConflictDetails();
    }
    return {
      reason,
      existingJobId: record.existingJobId
    };
  }

  if (!hasExactEnumerableDataKeys(record, ["reason"])) {
    return invalidRankRunConflictDetails();
  }
  return {
    reason: reason as Exclude<
      RankRunConflictReason,
      "EQUIVALENT_RUN_ACTIVE"
    >
  };
}

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
  readonly actorId?: string;
  readonly trackingContextId: string;
  readonly type: "MANUAL_RANK_CHECK";
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  /** Present on new runs; missing legacy values mean POSITION_TRACKING. */
  readonly purpose?: RankCollectionPurpose;
  readonly saveProjectPosition?: boolean;
  readonly xmlStockDepthMode?: "STRICT_DEPTH" | "STOP_AFTER_FOUND";
  /**
   * Safe presentation fields copied from the immutable execution snapshot.
   * They are optional only for legacy rows created before the projection was
   * introduced.
   */
  readonly searchEngine?: "GOOGLE" | "YANDEX";
  readonly searchSource?: RankSearchSource;
  readonly yandexLiveMode?: RankYandexLiveMode;
  readonly countryCode?: string;
  readonly regionCode?: string;
  readonly language?: string;
  readonly device?: "DESKTOP" | "MOBILE";
  readonly depth?: 10 | 20 | 30 | 50 | 100;
  readonly routingScope?: ConnectorRoutingScope;
  readonly connectorAttempts?: readonly ConnectorOperationAttemptSummary[];
  readonly operation: "POSITIONS";
  readonly credentialMode: "BYOK_API_KEY" | "PLATFORM_PAID";
  readonly progress: RankJobProgress;
  readonly platformChargeMicro: string;
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
  const geographicValues = [
    input.countryCode,
    input.regionCode,
    input.language,
    input.device
  ];
  const hasGeography = geographicValues.some(value => value !== undefined);
  if (
    input.type !== "MANUAL_RANK_CHECK" ||
    !["ARSENKIN", "XMLSTOCK"].includes(input.provider) ||
    input.operation !== "POSITIONS" ||
    (input.credentialMode !== "BYOK_API_KEY" &&
      input.credentialMode !== "PLATFORM_PAID") ||
    input.progress.unit !== "KEYWORD" ||
    !/^(?:0|[1-9]\d*)$/u.test(input.platformChargeMicro) ||
    (input.credentialMode === "BYOK_API_KEY" &&
      input.platformChargeMicro !== "0") ||
    (input.searchSource !== undefined &&
      input.searchSource !== "SEARCH_API" &&
      input.searchSource !== "LIVE") ||
    (input.searchSource !== undefined && input.searchEngine === undefined) ||
    (input.searchEngine === "GOOGLE" && input.searchSource === "SEARCH_API") ||
    (input.yandexLiveMode !== undefined &&
      (input.yandexLiveMode !== "TURBO" ||
        input.provider !== "XMLSTOCK" ||
        input.searchEngine !== "YANDEX" ||
        input.searchSource !== "LIVE")) ||
    (hasGeography && geographicValues.some(value => value === undefined)) ||
    (hasGeography && input.searchEngine === undefined) ||
    (input.countryCode !== undefined && !/^[A-Z]{2}$/u.test(input.countryCode)) ||
    (input.regionCode !== undefined &&
      (input.regionCode.length < 1 || input.regionCode.length > 100)) ||
    (input.language !== undefined &&
      (input.language.length < 2 || input.language.length > 16)) ||
    (input.device !== undefined &&
      input.device !== "DESKTOP" && input.device !== "MOBILE") ||
    (input.purpose !== undefined &&
      input.purpose !== "POSITION_TRACKING" &&
      input.purpose !== "COMPETITOR_SERP") ||
    (input.saveProjectPosition !== undefined &&
      typeof input.saveProjectPosition !== "boolean") ||
    (input.xmlStockDepthMode !== undefined &&
      input.xmlStockDepthMode !== "STRICT_DEPTH" &&
      input.xmlStockDepthMode !== "STOP_AFTER_FOUND") ||
    (input.xmlStockDepthMode !== undefined &&
      (input.provider !== "XMLSTOCK" || input.purpose === "COMPETITOR_SERP"))
  ) {
    return invalidRankJobLifecycle();
  }

  const base: RankJobSummaryBase = {
    id: input.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    ...(input.actorId ? { actorId: input.actorId } : {}),
    trackingContextId: input.trackingContextId,
    type: input.type,
    provider: input.provider,
    ...(input.purpose ? { purpose: input.purpose } : {}),
    ...(input.saveProjectPosition === undefined
      ? {}
      : { saveProjectPosition: input.saveProjectPosition }),
    ...(input.xmlStockDepthMode === undefined
      ? {}
      : { xmlStockDepthMode: input.xmlStockDepthMode }),
    ...(input.searchEngine ? { searchEngine: input.searchEngine } : {}),
    ...(input.searchSource ? { searchSource: input.searchSource } : {}),
    ...(input.yandexLiveMode ? { yandexLiveMode: input.yandexLiveMode } : {}),
    ...(input.countryCode ? { countryCode: input.countryCode } : {}),
    ...(input.regionCode ? { regionCode: input.regionCode } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.device ? { device: input.device } : {}),
    ...(input.depth ? { depth: input.depth } : {}),
    ...(input.routingScope ? { routingScope: input.routingScope } : {}),
    ...(input.connectorAttempts
      ? { connectorAttempts: input.connectorAttempts.map((attempt) => ({ ...attempt })) }
      : {}),
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
  ...[...ACTIVE_RANK_JOB_STAGES].filter(
    (stage) => stage !== "FINALIZING"
  )
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

function hasExactEnumerableDataKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[]
): boolean {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => keys.includes(key)) &&
    Object.getOwnPropertyNames(value).length === keys.length &&
    Object.values(descriptors).every(
      (descriptor) =>
        descriptor.enumerable && Object.hasOwn(descriptor, "value")
    )
  );
}

function invalidRankRunConflictDetails(): never {
  throw new TypeError("Invalid rank run conflict details");
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
  readonly jobCapacity: JobCapacityEntitlement;
  /** Trusted Core per-keyword price book; provider secrets are never present. */
  readonly providerPricesMinor: {
    readonly ARSENKIN: string | null;
    readonly XMLSTOCK: string | null;
  };
}

/**
 * Starts a new immutable child run for only the entries that were not
 * persisted by a partially completed parent run. Jobs resolves the original
 * estimate and SEO Data re-materializes the missing scope server-side; a
 * browser can never supply keyword identifiers.
 */
export interface InternalRetryRankJobInput
  extends Omit<
      InternalCreateRankRunInput,
      "estimateId" | "confirmedPlatformChargeMicro"
    >,
    InternalRankJobQuery {}

/**
 * Trusted, tenant-scoped Jobs query. Public callers never supply workspace,
 * project or actor identity in a body.
 */
export interface InternalRankJobQuery {
  readonly workspaceId: string;
  readonly projectId: string;
  /**
   * Requesting actor for audit only. It is not an ownership predicate:
   * authorized teammates can read and cancel project Jobs created by others.
   * The Jobs query must additionally filter type=MANUAL_RANK_CHECK.
   */
  readonly actorId: string;
  readonly jobId: string;
}

/**
 * Cooperative and idempotent cancellation. Jobs re-checks tenant scope and
 * state; cancel remains allowed when billing/project lifecycle becomes
 * read-only because it can only reduce future work. CANCEL_REQUESTED and
 * CANCELLED replay without mutation; another terminal state is returned
 * unchanged and is never rewritten as cancelled.
 */
export type InternalCancelRankJobInput = InternalRankJobQuery;

export interface RankManifestHash {
  readonly algorithm: "SHA_256";
  /**
   * Lowercase 64-character hexadecimal SHA-256 value. Where a field names
   * canonical JSON, it means RFC 8785 JCS encoded as UTF-8; producers and
   * verifiers must use canonicalJsonSha256 from the server-only
   * `@seo-platform/contracts/canonical-json` subpath. Its exact byte recipe
   * is `seo-platform.${domain}\0${RFC8785(value)}`, where domain is the
   * containing contract schema version (for example `rank-manifest@1`).
   * Fields using another recipe document it explicitly.
   */
  readonly value: string;
}

/**
 * Provider-neutral semantics sealed before provider execution. The adapter
 * may map these values only through providerMappingVersion; it must not
 * silently drop country, region, language, safe search or domain matching.
 */
export interface InternalRankExecutionParameters {
  /** Missing only on immutable legacy executions. */
  readonly purpose?: RankCollectionPurpose;
  /** Missing legacy values are true for position runs and false for competitor runs. */
  readonly saveProjectPosition?: boolean;
  /** Missing legacy values mean STRICT_DEPTH. XMLStock position runs only. */
  readonly xmlStockDepthMode?: "STRICT_DEPTH" | "STOP_AFTER_FOUND";
  readonly searchEngine: "GOOGLE" | "YANDEX";
  readonly countryCode: string;
  readonly regionCode?: string;
  readonly language: string;
  readonly device: TrackingDevice;
  readonly depth: 10 | 20 | 30 | 50 | 100;
  readonly domainMatchRule: TrackingDomainMatchRule;
  readonly safeSearch: boolean;
  readonly format: "SIMPLE";
  readonly rawSerp: false;
  readonly fallbackMode: "NONE";
  readonly providerMappingVersion: string;
}

export function rankExecutionPurpose(
  execution: Pick<InternalRankExecutionParameters, "purpose">
): RankCollectionPurpose {
  return execution.purpose ?? "POSITION_TRACKING";
}

export function rankExecutionTracksProjectPosition(
  execution: Pick<
    InternalRankExecutionParameters,
    "purpose" | "saveProjectPosition"
  >
): boolean {
  return rankExecutionPurpose(execution) === "POSITION_TRACKING"
    ? execution.saveProjectPosition !== false
    : execution.saveProjectPosition === true;
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
  /**
   * Original immutable estimate expiry. Exact replay remains valid after this
   * timestamp, but SEO Data must reject a new manifest when its authoritative
   * seal timestamp is greater than or equal to expiresAt.
   */
  readonly expiresAt: string;
}

/**
 * Jobs asks SEO Data to atomically re-check the estimate scope and seal it.
 * Any project/context/configuration/scope drift must fail as ESTIMATE_STALE;
 * the service must never partially seal a manifest.
 */
export interface InternalSealRankManifestInput {
  /** Absent on legacy commands. New commands explicitly pin their batching policy. */
  readonly providerPolicyVersion?: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly estimateId: string;
  /** Parent run whose still-missing immutable entries form this manifest. */
  readonly retryOfJobId?: string;
  readonly provider: "ARSENKIN" | "XMLSTOCK";
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
 * integers. New manifests contain one chunk up to 15,000 entries; immutable
 * legacy manifests retain 250-entry chunks. manifestHash covers the header
 * plus ordered chunk hashes.
 */
export interface InternalRankManifestSeal {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly estimateId: string;
  /**
   * Original immutable estimate expiry, included in the full manifest
   * integrity preimage. It is intentionally absent from semantic active-run
   * deduplication because it does not change provider work.
   */
  readonly estimateExpiresAt: string;
  /**
   * Audit actor that requested the immutable seal.
   */
  readonly sealedBy: string;
  readonly trackingContextId: string;
  readonly provider: "ARSENKIN" | "XMLSTOCK";
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
   * the complete immutable contract seal header (including run-specific IDs,
   * sealedBy, sealedAt and deduplicationHash) plus ordered chunk hashes, and
   * excludes manifestHash. Storage-only requestHash/createdAt are not contract
   * header fields. Producers and verifiers must build it with
   * rankManifestHashPreimage.
   */
  readonly manifestHash: RankManifestHash;
  /**
   * Semantic active-run deduplication hash. It covers tenant/project,
   * project domain, provider execution parameters, retention and ordered
   * keywordId+keywordTextHash+language entries. The semantic order is
   * ascending canonical lowercase keywordId text and is independent of
   * assignment identity or lifecycle timestamps. It excludes tracking
   * context identity, all logical revisions and configuration/scope evidence
   * hashes, as well as run/estimate/manifest/entry/assignment IDs, actor and
   * timestamps. Consequently cloning or renaming an equivalent context, a
   * display-only region label, project/keyword metadata change,
   * remove/reassign or a new idempotency key cannot bypass active
   * project+provider+deduplicationHash protection when provider work is
   * unchanged. Run-specific audit and evidence remain covered by the full
   * manifestHash.
   */
  readonly deduplicationHash: RankManifestHash;
  readonly pairCount: string;
  readonly chunkCount: string;
  readonly chunkSize: "1" | "250" | "5000" | "15000";
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
  /**
   * Zero-based position assigned by ascending canonical lowercase keywordId.
   */
  readonly sequence: number;
  readonly assignmentId: string;
  readonly keywordId: string;
  readonly keywordVersion: number;
  /**
   * Exact stored text, limited by the first Arsenkin slice to 500 Unicode
   * code points and 2,000 UTF-8 bytes before it may be materialized.
   */
  readonly keywordText: string;
  /**
   * SHA-256 over the exact raw UTF-8 bytes of keywordText, without Unicode
   * normalization, JSON encoding, delimiter or newline. Producers and
   * verifiers use utf8Sha256 from the server-only canonical-json subpath.
   */
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
   * SHA-256 over the exact rankManifestChunkHashPreimage output: schema
   * version, manifestId, chunkIndex and ordered complete entry DTOs. Tenant,
   * Job and chunkHash fields are excluded. Semantic deduplication is
   * calculated separately and must not reuse this run-specific hash.
   */
  readonly chunkHash: RankManifestHash;
  /**
   * Ordered by sequence, unique by entry/keyword and bounded to 15,000 rows.
   */
  readonly entries: readonly InternalRankManifestEntry[];
}

/**
 * Exact, versioned preimage used for a rank manifest chunk hash. Tenant and
 * Job identity are intentionally absent because they are covered by the full
 * manifest hash.
 */
export interface InternalRankManifestChunkHashPreimage {
  readonly hashSchemaVersion: "rank-manifest-chunk@1";
  readonly manifestId: string;
  readonly chunkIndex: number;
  readonly entries: readonly InternalRankManifestEntry[];
}

export interface InternalRankManifestDeduplicationKeyword {
  readonly keywordId: string;
  readonly keywordTextHash: RankManifestHash;
  readonly language: string;
}

/**
 * Exact semantic preimage for active-run deduplication. The opaque estimate
 * scopeHash and all run/assignment identities are deliberately absent.
 */
export interface InternalRankManifestDeduplicationHashPreimage {
  readonly hashSchemaVersion: "rank-manifest@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly project: {
    readonly domain: string;
  };
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  readonly operation: "POSITIONS";
  readonly execution: InternalRankExecutionParameters;
  readonly retention: {
    readonly normalizedRankHistory: "LONG_TERM";
    readonly rawSerp: "NOT_COLLECTED";
  };
  readonly keywords: readonly InternalRankManifestDeduplicationKeyword[];
}

export type InternalRankManifestSealWithoutHash = Omit<
  InternalRankManifestSeal,
  "manifestHash"
>;

/**
 * Exact full-manifest preimage. It is the complete immutable seal header
 * without manifestHash followed by chunk hashes in ascending chunkIndex.
 */
export type InternalRankManifestHashPreimage =
  InternalRankManifestSealWithoutHash & {
    readonly chunkHashes: readonly RankManifestHash[];
  };

/**
 * Rebuilds the chunk preimage through an allowlist. Runtime-only extra fields
 * on a structurally compatible DTO cannot silently change the hash recipe.
 */
export function rankManifestChunkHashPreimage(
  input: Pick<
    InternalRankManifestChunk,
    "hashSchemaVersion" | "manifestId" | "chunkIndex" | "entries"
  >
): InternalRankManifestChunkHashPreimage {
  return {
    hashSchemaVersion: input.hashSchemaVersion,
    manifestId: input.manifestId,
    chunkIndex: input.chunkIndex,
    entries: input.entries.map(copyRankManifestEntry)
  };
}

/**
 * Rebuilds and deterministically orders the semantic active-run preimage.
 */
export function rankManifestDeduplicationHashPreimage(
  input: InternalSealRankManifestInput,
  entries: readonly InternalRankManifestEntry[]
): InternalRankManifestDeduplicationHashPreimage {
  const keywords = [...entries]
    .sort(compareRankManifestKeywordIds)
    .map((entry) => ({
      keywordId: entry.keywordId,
      keywordTextHash: copyRankManifestHash(entry.keywordTextHash),
      language: entry.language
    }));

  return {
    hashSchemaVersion: "rank-manifest@1",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    project: {
      domain: input.project.domain
    },
    provider: input.provider,
    operation: input.operation,
    execution: copyRankExecutionParameters(input.execution),
    retention: {
      normalizedRankHistory: input.retention.normalizedRankHistory,
      rawSerp: input.retention.rawSerp
    },
    keywords
  };
}

/**
 * Rebuilds the complete manifest preimage through an allowlist.
 */
export function rankManifestHashPreimage(
  seal: InternalRankManifestSealWithoutHash,
  chunkHashes: readonly RankManifestHash[]
): InternalRankManifestHashPreimage {
  return {
    id: seal.id,
    workspaceId: seal.workspaceId,
    projectId: seal.projectId,
    jobId: seal.jobId,
    estimateId: seal.estimateId,
    estimateExpiresAt: seal.estimateExpiresAt,
    sealedBy: seal.sealedBy,
    trackingContextId: seal.trackingContextId,
    provider: seal.provider,
    operation: seal.operation,
    project: {
      id: seal.project.id,
      workspaceId: seal.project.workspaceId,
      domain: seal.project.domain,
      status: seal.project.status,
      version: seal.project.version
    },
    contextVersion: seal.contextVersion,
    configurationVersion: seal.configurationVersion,
    configurationHash: copyRankManifestHash(seal.configurationHash),
    semanticScopeHash: copyRankManifestHash(seal.semanticScopeHash),
    scopeHash: copyRankManifestHash(seal.scopeHash),
    hashSchemaVersion: seal.hashSchemaVersion,
    deduplicationHash: copyRankManifestHash(seal.deduplicationHash),
    pairCount: seal.pairCount,
    chunkCount: seal.chunkCount,
    chunkSize: seal.chunkSize,
    execution: copyRankExecutionParameters(seal.execution),
    retention: {
      normalizedRankHistory: seal.retention.normalizedRankHistory,
      rawSerp: seal.retention.rawSerp
    },
    status: seal.status,
    sealedAt: seal.sealedAt,
    chunkHashes: chunkHashes.map(copyRankManifestHash)
  };
}

function copyRankManifestEntry(
  entry: InternalRankManifestEntry
): InternalRankManifestEntry {
  return {
    id: entry.id,
    sequence: entry.sequence,
    assignmentId: entry.assignmentId,
    keywordId: entry.keywordId,
    keywordVersion: entry.keywordVersion,
    keywordText: entry.keywordText,
    keywordTextHash: copyRankManifestHash(entry.keywordTextHash),
    language: entry.language
  };
}

function copyRankManifestHash(
  hash: RankManifestHash
): RankManifestHash {
  return {
    algorithm: hash.algorithm,
    value: hash.value
  };
}

function copyRankExecutionParameters(
  execution: InternalRankExecutionParameters
): InternalRankExecutionParameters {
  const domainMatchRule: TrackingDomainMatchRule =
    execution.domainMatchRule.mode === "SPECIFIC_URL" ||
    execution.domainMatchRule.mode === "URL_PREFIX"
      ? {
          mode: execution.domainMatchRule.mode,
          value: execution.domainMatchRule.value
        }
      : { mode: execution.domainMatchRule.mode };

  return {
    ...(execution.purpose === undefined
      ? {}
      : { purpose: execution.purpose }),
    ...(execution.saveProjectPosition === undefined
      ? {}
      : { saveProjectPosition: execution.saveProjectPosition }),
    ...(execution.xmlStockDepthMode === undefined
      ? {}
      : { xmlStockDepthMode: execution.xmlStockDepthMode }),
    searchEngine: execution.searchEngine,
    countryCode: execution.countryCode,
    ...(execution.regionCode === undefined
      ? {}
      : { regionCode: execution.regionCode }),
    language: execution.language,
    device: execution.device,
    depth: execution.depth,
    domainMatchRule,
    safeSearch: execution.safeSearch,
    format: execution.format,
    rawSerp: execution.rawSerp,
    fallbackMode: execution.fallbackMode,
    providerMappingVersion: execution.providerMappingVersion
  };
}

function compareRankManifestKeywordIds(
  left: InternalRankManifestEntry,
  right: InternalRankManifestEntry
): number {
  const leftCanonical = left.keywordId.toLowerCase();
  const rightCanonical = right.keywordId.toLowerCase();
  if (leftCanonical < rightCanonical) return -1;
  if (leftCanonical > rightCanonical) return 1;
  if (left.keywordId < right.keywordId) return -1;
  if (left.keywordId > right.keywordId) return 1;
  return 0;
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

export const rankResultChunkMaxCount = rankCommandKeywordLimit;
export const rankResultPairMaxCount = rankCommandKeywordLimit;
export const rankSerpResultMaxCount = 100 as const;

interface InternalNormalizedRankResultBase {
  readonly manifestEntryId: string;
  readonly keywordId: string;
  /**
   * Unique finite flags. The canonical ingest builder orders them by
   * normalizedRankDataQualityFlags before hashing. For a found result each
   * field-specific UNAVAILABLE flag is present if and only if its optional
   * field is absent. A not-found result may carry only
   * PROVIDER_OBSERVED_AT_UNAVAILABLE.
   */
  readonly dataQualityFlags: readonly NormalizedRankDataQualityFlag[];
  /**
   * Normalized organic results captured from the same provider response.
   * The projection contains at most the sealed collection depth (TOP-100),
   * never raw provider payload. The array is strictly ordered by unique
   * organic position; providers that do not expose the SERP omit the field.
   */
  readonly serpResults?: readonly InternalNormalizedRankSerpResult[];
}

export interface InternalNormalizedRankSerpResult {
  readonly position: number;
  readonly rankingUrl: string;
  readonly normalizedRankingUrl: string;
  /** Safe absolute favicon URL returned as part of the provider SERP row. */
  readonly faviconUrl?: string;
  readonly title?: string;
  readonly snippet?: string;
}

/**
 * position is an integer from 1 through the sealed depth. Optional
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
 * Complete normalized command before its canonical envelope hash is added.
 * Tenant and actor identity are supplied only by trusted internal callers;
 * browser/public API bodies never contain them.
 */
export interface InternalRankChunkIngestCommand {
  readonly schemaVersion: "rank-ingest@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly manifestId: string;
  readonly chunkIndex: number;
  /**
   * Exact hash of the immutable sealed chunk. It binds normalized output to
   * the content that was actually sent to the provider and is verified
   * against SEO Data before persistence.
   */
  readonly manifestChunkHash: RankManifestHash;
  readonly provider: "ARSENKIN" | "XMLSTOCK";
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
  /**
   * Exact full one-to-one projection of the sealed chunk in manifest
   * sequence order. A provider omission is represented explicitly as
   * found=false; missing, duplicate, foreign or reordered rows are invalid.
   */
  readonly results: readonly InternalNormalizedRankResult[];
}

/**
 * Exact JCS hash preimage. It is rebuilt through the server-only
 * `@seo-platform/contracts/rank-results-canonical` subpath, which verifies
 * the sealed chunk membership/order and rejects extra or non-canonical
 * fields.
 */
export type InternalRankChunkIngestHashPreimage =
  InternalRankChunkIngestCommand;

/**
 * ingestEnvelopeHash is SHA-256 over the complete exact command under the
 * `rank-ingest@1` domain separator, excluding only the hash field itself.
 * It covers tenant/job/item/manifest/chunk identity and hash, actor,
 * providerRequestId, connectorVersion, observedAt and every normalized
 * result, but never raw provider bytes.
 */
export interface InternalIngestRankChunkInput
  extends InternalRankChunkIngestCommand {
  readonly ingestEnvelopeHash: RankManifestHash;
}

/** Bounded XMLStock one-key chunks committed in one SEO Data transaction. */
export const rankResultBatchMaxItems = 16;

export interface InternalIngestRankBatchInput {
  readonly schemaVersion: "rank-ingest-batch@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly manifestId: string;
  readonly items: readonly InternalIngestRankChunkInput[];
}

/**
 * Exact replay returns the same receipt. The same manifest/chunk identity
 * with another hash is an idempotency conflict. currentSkippedCount records
 * observations that lost the monotonic `(observedAt, snapshotId)` current
 * projection comparison. All decimal counts are canonical non-negative
 * integers bounded by 15,000.
 */
export interface InternalRankChunkIngestReceipt {
  readonly schemaVersion: "rank-ingest@1";
  readonly workspaceId: string;
  readonly projectId: string;
  /**
   * Provenance of the first successful write. Exact replay returns this
   * original value and never replaces it with the replaying actor.
   */
  readonly ingestedBy: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly manifestId: string;
  readonly chunkIndex: number;
  readonly manifestChunkHash: RankManifestHash;
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
 * CANCELLED permits 0<=persistedCount<=pairCount because already accepted
 * provider work is still persisted. FAILED requires persistedCount=0;
 * otherwise the truthful status is PARTIALLY_COMPLETED. ACTION_REQUIRED
 * preserves SUBMIT_OUTCOME_UNKNOWN without a completed event and requires
 * persistedCount<pairCount, though other chunks may already be persisted.
 * A failure before manifest seal is finalized only in Jobs and must not call
 * this SEO Data finalization boundary.
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

/**
 * Exact finalize idempotency identity. actorId is deliberately excluded:
 * the first successful writer becomes immutable audit provenance and another
 * authorized actor replaying job+manifest+status receives that receipt.
 */
export interface InternalRankCheckFinalizationHashPreimage {
  readonly schemaVersion: "rank-finalize@1";
  readonly workspaceId: string;
  readonly projectId: string;
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
  /**
   * Canonical non-negative decimal strings bounded by 1,000. pairCount is
   * positive; persistedCount=foundCount+notFoundCount and
   * missingCount=pairCount-persistedCount.
   */
  readonly pairCount: string;
  readonly persistedCount: string;
  readonly foundCount: string;
  readonly notFoundCount: string;
  readonly missingCount: string;
  readonly finalizedAt: string;
}
