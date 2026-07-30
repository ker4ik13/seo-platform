export const RANK_PROVIDER_LIFECYCLE_SCHEMA =
  "rank-provider-lifecycle@1";
export const RANK_PROVIDER_LIFECYCLE_INIT_SCHEMA =
  "rank-provider-lifecycle-init@1";
export const RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA =
  "rank-provider-lifecycle-event@1";
export const RANK_PROVIDER_CONTRACT_CAPABILITIES_SCHEMA =
  "rank-provider-contract-capabilities@1";
export const RANK_PROVIDER_RESULT_FACTS_SCHEMA =
  "rank-provider-result-facts@1";

export const rankProviderLifecycleStates = [
  "READY_TO_SUBMIT",
  "CLAIMED",
  "SUBMITTING",
  "SUBMIT_OUTCOME_UNKNOWN",
  "SUBMITTED",
  "POLL_WAIT",
  "RESULT_READY",
  "FETCHING",
  "NORMALIZED",
  "STAGED",
  "PERSISTED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "CANCELLED"
] as const;

export type RankProviderLifecycleState =
  (typeof rankProviderLifecycleStates)[number];

export const rankProviderLifecycleEventTypes = [
  "CLAIM",
  "RENEW_LEASE",
  "BEGIN_SUBMIT",
  "SUBMIT_ACCEPTED",
  "SUBMIT_FAILED",
  "RECOVER_EXPIRED_ACTION",
  "SCHEDULE_POLL",
  "BEGIN_POLL",
  "POLL_PENDING",
  "POLL_RESULT_READY",
  "POLL_FAILED",
  "BEGIN_FETCH",
  "FETCH_NORMALIZED",
  "FETCH_FAILED",
  "STAGE_RESULT",
  "BEGIN_PERSIST",
  "PERSISTED",
  "PERSIST_FAILED",
  "RETRY_DUE",
  "CANCEL"
] as const;

export type RankProviderLifecycleEventType =
  (typeof rankProviderLifecycleEventTypes)[number];

export type RankProviderFailurePhase =
  | "SUBMIT"
  | "POLL"
  | "FETCH"
  | "PERSIST";

export const rankProviderFailureCodes = [
  "SUBMIT_LOCAL_PRE_SEND",
  "SUBMIT_RATE_LIMITED",
  "SUBMIT_ATTEMPTS_EXHAUSTED",
  "SUBMIT_REJECTED",
  "SUBMIT_OUTCOME_UNKNOWN",
  "POLL_RATE_LIMITED",
  "POLL_TEMPORARY",
  "POLL_REPEATABILITY_UNCONFIRMED",
  "POLL_ATTEMPTS_EXHAUSTED",
  "POLL_REJECTED",
  "POLL_INVALID_RESPONSE",
  "FETCH_RATE_LIMITED",
  "FETCH_TEMPORARY",
  "FETCH_REPEATABILITY_UNCONFIRMED",
  "FETCH_ATTEMPTS_EXHAUSTED",
  "FETCH_REJECTED",
  "FETCH_INVALID_RESPONSE",
  "PERSISTENCE_TEMPORARY",
  "PERSISTENCE_ATTEMPTS_EXHAUSTED"
] as const;

export type RankProviderFailureCode =
  (typeof rankProviderFailureCodes)[number];

export interface RankProviderContractCapabilitiesV1 {
  readonly schemaVersion: typeof RANK_PROVIDER_CONTRACT_CAPABILITIES_SCHEMA;
  readonly pollRepeatabilityConfirmed: boolean;
  readonly fetchRepeatabilityConfirmed: boolean;
}

export interface RankProviderActionCounts {
  readonly submit: number;
  readonly poll: number;
  readonly fetch: number;
  readonly persist: number;
}

export interface RankProviderFailureFact {
  readonly phase: RankProviderFailurePhase;
  readonly code: RankProviderFailureCode;
}

export interface RankProviderResultFactsV1 {
  readonly schemaVersion: typeof RANK_PROVIDER_RESULT_FACTS_SCHEMA;
  readonly normalizedPayloadSha256: string;
  readonly rowCount: number;
}

export interface RankProviderLifecycleSnapshotV1 {
  readonly schemaVersion: typeof RANK_PROVIDER_LIFECYCLE_SCHEMA;
  readonly state: RankProviderLifecycleState;
  readonly version: number;
  readonly updatedAt: string;
  readonly attempts: RankProviderActionCounts;
  readonly limits: RankProviderActionCounts;
  readonly capabilities: RankProviderContractCapabilitiesV1;
  readonly leaseGeneration: number;
  readonly leaseOwner: string | null;
  readonly leaseToken: string | null;
  readonly leaseExpiresAt: string | null;
  readonly activeAction: "NONE" | "POLL" | "PERSIST";
  readonly submitMayHaveStarted: boolean;
  readonly providerTaskId: string | null;
  readonly nextActionAt: string | null;
  readonly failure: RankProviderFailureFact | null;
  readonly resultFacts: RankProviderResultFactsV1 | null;
}

export type RankProviderSubmitFailureOutcome =
  | "LOCAL_PRE_SEND"
  | "EXPLICIT_429"
  | "AMBIGUOUS_TRANSPORT"
  | "AMBIGUOUS_5XX"
  | "INVALID_RESPONSE"
  | "FINAL_REJECTION";

export type RankProviderRepeatableActionFailureOutcome =
  | "EXPLICIT_429"
  | "TEMPORARY"
  | "INVALID_RESPONSE"
  | "FINAL_REJECTION";

interface RankProviderLifecycleEventBase {
  readonly schemaVersion: typeof RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA;
  readonly type: RankProviderLifecycleEventType;
  readonly expectedVersion: number;
  readonly at: string;
}

interface RankProviderLeaseProof {
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseGeneration: number;
}

export type RankProviderLifecycleEventV1 =
  | (RankProviderLifecycleEventBase & {
      readonly type: "CLAIM";
      readonly leaseOwner: string;
      readonly leaseToken: string;
      readonly leaseExpiresAt: string;
    })
  | (RankProviderLifecycleEventBase &
      RankProviderLeaseProof & {
        readonly type: "RENEW_LEASE";
        readonly leaseExpiresAt: string;
      })
  | (RankProviderLifecycleEventBase &
      RankProviderLeaseProof & {
        readonly type:
          | "BEGIN_SUBMIT"
          | "POLL_RESULT_READY"
          | "BEGIN_FETCH"
          | "STAGE_RESULT"
          | "BEGIN_PERSIST"
          | "PERSISTED";
      })
  | (RankProviderLifecycleEventBase &
      RankProviderLeaseProof & {
        readonly type: "SUBMIT_ACCEPTED";
        readonly providerTaskId: string;
      })
  | (RankProviderLifecycleEventBase &
      RankProviderLeaseProof & {
        readonly type: "SUBMIT_FAILED";
        readonly outcome: RankProviderSubmitFailureOutcome;
        readonly retryAt: string | null;
      })
  | (RankProviderLifecycleEventBase & {
      readonly type: "RECOVER_EXPIRED_ACTION";
      readonly retryAt: string;
    })
  | (RankProviderLifecycleEventBase & {
      readonly type: "SCHEDULE_POLL";
      readonly nextActionAt: string;
    })
  | (RankProviderLifecycleEventBase &
      RankProviderLeaseProof & {
        readonly type: "BEGIN_POLL";
      })
  | (RankProviderLifecycleEventBase &
      RankProviderLeaseProof & {
        readonly type: "POLL_PENDING";
        readonly nextActionAt: string;
      })
  | (RankProviderLifecycleEventBase &
      RankProviderLeaseProof & {
        readonly type: "POLL_FAILED" | "FETCH_FAILED";
        readonly outcome: RankProviderRepeatableActionFailureOutcome;
        readonly retryAt: string | null;
      })
  | (RankProviderLifecycleEventBase &
      RankProviderLeaseProof & {
        readonly type: "FETCH_NORMALIZED";
        readonly resultFacts: RankProviderResultFactsV1;
      })
  | (RankProviderLifecycleEventBase &
      RankProviderLeaseProof & {
        readonly type: "PERSIST_FAILED";
        readonly retryAt: string;
      })
  | (RankProviderLifecycleEventBase & {
      readonly type: "RETRY_DUE";
    })
  | (RankProviderLifecycleEventBase & {
      readonly type: "CANCEL";
    });

export type RankProviderLifecycleErrorCode =
  | "INVALID_SNAPSHOT"
  | "INVALID_EVENT"
  | "ILLEGAL_TRANSITION"
  | "VERSION_CONFLICT"
  | "LEASE_CONFLICT"
  | "NOT_DUE";

export class RankProviderLifecycleError extends Error {
  readonly code: RankProviderLifecycleErrorCode;

  constructor(code: RankProviderLifecycleErrorCode, message: string) {
    super(message);
    this.name = "RankProviderLifecycleError";
    this.code = code;
  }
}

export const rankProviderLifecycleTransitionMatrix: Readonly<
  Record<RankProviderLifecycleState, readonly RankProviderLifecycleEventType[]>
> = {
  READY_TO_SUBMIT: ["CLAIM", "CANCEL"],
  CLAIMED: [
    "RENEW_LEASE",
    "BEGIN_SUBMIT",
    "RECOVER_EXPIRED_ACTION",
    "CANCEL"
  ],
  SUBMITTING: [
    "RENEW_LEASE",
    "SUBMIT_ACCEPTED",
    "SUBMIT_FAILED",
    "RECOVER_EXPIRED_ACTION"
  ],
  SUBMIT_OUTCOME_UNKNOWN: [],
  SUBMITTED: ["SCHEDULE_POLL"],
  POLL_WAIT: [
    "CLAIM",
    "RENEW_LEASE",
    "BEGIN_POLL",
    "POLL_PENDING",
    "POLL_RESULT_READY",
    "POLL_FAILED",
    "RECOVER_EXPIRED_ACTION"
  ],
  RESULT_READY: [
    "CLAIM",
    "RENEW_LEASE",
    "BEGIN_FETCH",
    "RECOVER_EXPIRED_ACTION"
  ],
  FETCHING: [
    "RENEW_LEASE",
    "FETCH_NORMALIZED",
    "FETCH_FAILED",
    "RECOVER_EXPIRED_ACTION"
  ],
  NORMALIZED: [
    "RENEW_LEASE",
    "STAGE_RESULT",
    "RECOVER_EXPIRED_ACTION"
  ],
  STAGED: [
    "CLAIM",
    "RENEW_LEASE",
    "BEGIN_PERSIST",
    "PERSISTED",
    "PERSIST_FAILED",
    "RECOVER_EXPIRED_ACTION"
  ],
  PERSISTED: [],
  FAILED_RETRYABLE: ["RETRY_DUE", "CANCEL"],
  FAILED_FINAL: [],
  CANCELLED: []
};

const STATE_SET = new Set<string>(rankProviderLifecycleStates);
const EVENT_TYPE_SET = new Set<string>(rankProviderLifecycleEventTypes);
const FAILURE_CODE_SET = new Set<string>(rankProviderFailureCodes);
const PHASE_SET = new Set<string>(["SUBMIT", "POLL", "FETCH", "PERSIST"]);
const ACTIVE_ACTION_SET = new Set<string>(["NONE", "POLL", "PERSIST"]);
const SUBMIT_FAILURE_OUTCOME_SET = new Set<string>([
  "LOCAL_PRE_SEND",
  "EXPLICIT_429",
  "AMBIGUOUS_TRANSPORT",
  "AMBIGUOUS_5XX",
  "INVALID_RESPONSE",
  "FINAL_REJECTION"
]);
const REPEATABLE_FAILURE_OUTCOME_SET = new Set<string>([
  "EXPLICIT_429",
  "TEMPORARY",
  "INVALID_RESPONSE",
  "FINAL_REJECTION"
]);
const RETRYABLE_FAILURE_CODES: Readonly<
  Record<RankProviderFailurePhase, ReadonlySet<RankProviderFailureCode>>
> = {
  SUBMIT: new Set(["SUBMIT_LOCAL_PRE_SEND", "SUBMIT_RATE_LIMITED"]),
  POLL: new Set(["POLL_RATE_LIMITED", "POLL_TEMPORARY"]),
  FETCH: new Set(["FETCH_RATE_LIMITED", "FETCH_TEMPORARY"]),
  PERSIST: new Set(["PERSISTENCE_TEMPORARY"])
};
const FINAL_FAILURE_CODES: Readonly<
  Record<RankProviderFailurePhase, ReadonlySet<RankProviderFailureCode>>
> = {
  SUBMIT: new Set(["SUBMIT_ATTEMPTS_EXHAUSTED", "SUBMIT_REJECTED"]),
  POLL: new Set([
    "POLL_REPEATABILITY_UNCONFIRMED",
    "POLL_ATTEMPTS_EXHAUSTED",
    "POLL_REJECTED",
    "POLL_INVALID_RESPONSE"
  ]),
  FETCH: new Set([
    "FETCH_REPEATABILITY_UNCONFIRMED",
    "FETCH_ATTEMPTS_EXHAUSTED",
    "FETCH_REJECTED",
    "FETCH_INVALID_RESPONSE"
  ]),
  PERSIST: new Set(["PERSISTENCE_ATTEMPTS_EXHAUSTED"])
};

export function createRankProviderLifecycle(
  value: unknown
): RankProviderLifecycleSnapshotV1 {
  const input = record(value, "INVALID_EVENT");
  const fields = Object.keys(input);
  const allowed = new Set([
    "schemaVersion",
    "at",
    "limits",
    "capabilities"
  ]);
  if (
    input.schemaVersion !== RANK_PROVIDER_LIFECYCLE_INIT_SCHEMA ||
    fields.some((field) => !allowed.has(field)) ||
    !fields.includes("schemaVersion") ||
    !fields.includes("at") ||
    !fields.includes("limits")
  ) {
    invalidEvent();
  }
  const at = timestamp(input.at, "INVALID_EVENT");
  const limits = actionCounts(input.limits, false, "INVALID_EVENT");
  const capabilities =
    "capabilities" in input
      ? contractCapabilities(input.capabilities, "INVALID_EVENT")
      : {
          schemaVersion: RANK_PROVIDER_CONTRACT_CAPABILITIES_SCHEMA,
          pollRepeatabilityConfirmed: false,
          fetchRepeatabilityConfirmed: false
        };

  return rankProviderLifecycleSnapshot({
    schemaVersion: RANK_PROVIDER_LIFECYCLE_SCHEMA,
    state: "READY_TO_SUBMIT",
    version: 1,
    updatedAt: at,
    attempts: { submit: 0, poll: 0, fetch: 0, persist: 0 },
    limits,
    capabilities,
    leaseGeneration: 0,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    activeAction: "NONE",
    submitMayHaveStarted: false,
    providerTaskId: null,
    nextActionAt: null,
    failure: null,
    resultFacts: null
  });
}

export function rankProviderLifecycleSnapshot(
  value: unknown
): RankProviderLifecycleSnapshotV1 {
  const input = exactRecord(
    value,
    [
      "schemaVersion",
      "state",
      "version",
      "updatedAt",
      "attempts",
      "limits",
      "capabilities",
      "leaseGeneration",
      "leaseOwner",
      "leaseToken",
      "leaseExpiresAt",
      "activeAction",
      "submitMayHaveStarted",
      "providerTaskId",
      "nextActionAt",
      "failure",
      "resultFacts"
    ],
    "INVALID_SNAPSHOT"
  );
  if (
    input.schemaVersion !== RANK_PROVIDER_LIFECYCLE_SCHEMA ||
    typeof input.state !== "string" ||
    !STATE_SET.has(input.state) ||
    typeof input.activeAction !== "string" ||
    !ACTIVE_ACTION_SET.has(input.activeAction) ||
    typeof input.submitMayHaveStarted !== "boolean"
  ) {
    invalidSnapshot();
  }

  const attempts = actionCounts(input.attempts, true, "INVALID_SNAPSHOT");
  const limits = actionCounts(input.limits, false, "INVALID_SNAPSHOT");
  for (const key of actionCountKeys) {
    if (attempts[key] > limits[key]) invalidSnapshot();
  }

  const snapshot: RankProviderLifecycleSnapshotV1 = {
    schemaVersion: RANK_PROVIDER_LIFECYCLE_SCHEMA,
    state: input.state as RankProviderLifecycleState,
    version: positiveInteger(input.version, "INVALID_SNAPSHOT"),
    updatedAt: timestamp(input.updatedAt, "INVALID_SNAPSHOT"),
    attempts,
    limits,
    capabilities: contractCapabilities(
      input.capabilities,
      "INVALID_SNAPSHOT"
    ),
    leaseGeneration: nonnegativeInteger(
      input.leaseGeneration,
      "INVALID_SNAPSHOT"
    ),
    leaseOwner: nullableLeaseOwner(input.leaseOwner, "INVALID_SNAPSHOT"),
    leaseToken: nullableLeaseToken(input.leaseToken, "INVALID_SNAPSHOT"),
    leaseExpiresAt: nullableTimestamp(
      input.leaseExpiresAt,
      "INVALID_SNAPSHOT"
    ),
    activeAction: input.activeAction as RankProviderLifecycleSnapshotV1["activeAction"],
    submitMayHaveStarted: input.submitMayHaveStarted,
    providerTaskId: nullableProviderTaskId(
      input.providerTaskId,
      "INVALID_SNAPSHOT"
    ),
    nextActionAt: nullableTimestamp(
      input.nextActionAt,
      "INVALID_SNAPSHOT"
    ),
    failure:
      input.failure === null
        ? null
        : failureFact(input.failure, "INVALID_SNAPSHOT"),
    resultFacts:
      input.resultFacts === null
        ? null
        : resultFacts(input.resultFacts, "INVALID_SNAPSHOT")
  };

  validateSnapshotShape(snapshot);
  return snapshot;
}

export function rankProviderLifecycleEvent(
  value: unknown
): RankProviderLifecycleEventV1 {
  const source = record(value, "INVALID_EVENT");
  if (
    source.schemaVersion !== RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA ||
    typeof source.type !== "string" ||
    !EVENT_TYPE_SET.has(source.type)
  ) {
    invalidEvent();
  }
  const type = source.type as RankProviderLifecycleEventType;
  const base = eventBase(source, type);

  switch (type) {
    case "CLAIM": {
      const input = eventRecord(source, [
        "leaseOwner",
        "leaseToken",
        "leaseExpiresAt"
      ]);
      return {
        ...base,
        type,
        leaseOwner: leaseOwner(input.leaseOwner, "INVALID_EVENT"),
        leaseToken: leaseToken(input.leaseToken, "INVALID_EVENT"),
        leaseExpiresAt: timestamp(input.leaseExpiresAt, "INVALID_EVENT")
      };
    }
    case "RENEW_LEASE": {
      const input = eventRecord(source, [
        "leaseOwner",
        "leaseToken",
        "leaseGeneration",
        "leaseExpiresAt"
      ]);
      return {
        ...base,
        type,
        ...leaseProof(input),
        leaseExpiresAt: timestamp(input.leaseExpiresAt, "INVALID_EVENT")
      };
    }
    case "BEGIN_SUBMIT":
    case "POLL_RESULT_READY":
    case "BEGIN_FETCH":
    case "STAGE_RESULT":
    case "BEGIN_PERSIST":
    case "PERSISTED": {
      const input = eventRecord(source, [
        "leaseOwner",
        "leaseToken",
        "leaseGeneration"
      ]);
      return { ...base, type, ...leaseProof(input) };
    }
    case "SUBMIT_ACCEPTED": {
      const input = eventRecord(source, [
        "leaseOwner",
        "leaseToken",
        "leaseGeneration",
        "providerTaskId"
      ]);
      return {
        ...base,
        type,
        ...leaseProof(input),
        providerTaskId: providerTaskId(
          input.providerTaskId,
          "INVALID_EVENT"
        )
      };
    }
    case "SUBMIT_FAILED": {
      const input = eventRecord(source, [
        "leaseOwner",
        "leaseToken",
        "leaseGeneration",
        "outcome",
        "retryAt"
      ]);
      if (
        typeof input.outcome !== "string" ||
        !SUBMIT_FAILURE_OUTCOME_SET.has(input.outcome)
      ) {
        invalidEvent();
      }
      return {
        ...base,
        type,
        ...leaseProof(input),
        outcome: input.outcome as RankProviderSubmitFailureOutcome,
        retryAt: nullableTimestamp(input.retryAt, "INVALID_EVENT")
      };
    }
    case "RECOVER_EXPIRED_ACTION": {
      const input = eventRecord(source, ["retryAt"]);
      return {
        ...base,
        type,
        retryAt: timestamp(input.retryAt, "INVALID_EVENT")
      };
    }
    case "SCHEDULE_POLL": {
      const input = eventRecord(source, ["nextActionAt"]);
      return {
        ...base,
        type,
        nextActionAt: timestamp(input.nextActionAt, "INVALID_EVENT")
      };
    }
    case "BEGIN_POLL": {
      const input = eventRecord(source, [
        "leaseOwner",
        "leaseToken",
        "leaseGeneration"
      ]);
      return { ...base, type, ...leaseProof(input) };
    }
    case "POLL_PENDING": {
      const input = eventRecord(source, [
        "leaseOwner",
        "leaseToken",
        "leaseGeneration",
        "nextActionAt"
      ]);
      return {
        ...base,
        type,
        ...leaseProof(input),
        nextActionAt: timestamp(input.nextActionAt, "INVALID_EVENT")
      };
    }
    case "POLL_FAILED":
    case "FETCH_FAILED": {
      const input = eventRecord(source, [
        "leaseOwner",
        "leaseToken",
        "leaseGeneration",
        "outcome",
        "retryAt"
      ]);
      if (
        typeof input.outcome !== "string" ||
        !REPEATABLE_FAILURE_OUTCOME_SET.has(input.outcome)
      ) {
        invalidEvent();
      }
      return {
        ...base,
        type,
        ...leaseProof(input),
        outcome: input.outcome as RankProviderRepeatableActionFailureOutcome,
        retryAt: nullableTimestamp(input.retryAt, "INVALID_EVENT")
      };
    }
    case "FETCH_NORMALIZED": {
      const input = eventRecord(source, [
        "leaseOwner",
        "leaseToken",
        "leaseGeneration",
        "resultFacts"
      ]);
      return {
        ...base,
        type,
        ...leaseProof(input),
        resultFacts: resultFacts(input.resultFacts, "INVALID_EVENT")
      };
    }
    case "PERSIST_FAILED": {
      const input = eventRecord(source, [
        "leaseOwner",
        "leaseToken",
        "leaseGeneration",
        "retryAt"
      ]);
      return {
        ...base,
        type,
        ...leaseProof(input),
        retryAt: timestamp(input.retryAt, "INVALID_EVENT")
      };
    }
    case "RETRY_DUE":
    case "CANCEL":
      eventRecord(source, []);
      return { ...base, type };
  }
}

export function reduceRankProviderLifecycle(
  stored: unknown,
  inputEvent: unknown
): RankProviderLifecycleSnapshotV1 {
  const current = rankProviderLifecycleSnapshot(stored);
  const event = rankProviderLifecycleEvent(inputEvent);
  if (event.expectedVersion !== current.version) {
    fail("VERSION_CONFLICT", "Rank provider lifecycle version conflict");
  }
  if (millis(event.at) < millis(current.updatedAt)) {
    fail("ILLEGAL_TRANSITION", "Rank provider lifecycle time regressed");
  }
  if (!rankProviderLifecycleTransitionMatrix[current.state].includes(event.type)) {
    fail(
      "ILLEGAL_TRANSITION",
      "Rank provider lifecycle transition is not allowed"
    );
  }

  switch (event.type) {
    case "CLAIM":
      return claim(current, event);
    case "RENEW_LEASE":
      return renewLease(current, event);
    case "BEGIN_SUBMIT":
      assertState(current, "CLAIMED");
      requireLease(current, event);
      if (current.attempts.submit >= current.limits.submit) {
        return finalFailure(
          current,
          event.at,
          "SUBMIT",
          "SUBMIT_ATTEMPTS_EXHAUSTED"
        );
      }
      return next(current, event.at, {
        state: "SUBMITTING",
        attempts: increment(current.attempts, "submit"),
        // The authorize transaction commits before the caller may send any
        // provider bytes. From that durable point onward a crash cannot prove
        // that the external side effect did not start, so automatic resubmit
        // is forbidden even if the process died before invoking fetch().
        submitMayHaveStarted: true
      });
    case "SUBMIT_ACCEPTED":
      assertState(current, "SUBMITTING");
      requireLease(current, event);
      if (!current.submitMayHaveStarted || current.providerTaskId !== null) {
        illegal();
      }
      return next(current, event.at, {
        state: "SUBMITTED",
        providerTaskId: event.providerTaskId,
        ...releasedLease()
      });
    case "SUBMIT_FAILED":
      return submitFailed(current, event);
    case "RECOVER_EXPIRED_ACTION":
      return recoverExpiredAction(current, event);
    case "SCHEDULE_POLL":
      assertState(current, "SUBMITTED");
      requireAtOrAfter(event.nextActionAt, event.at);
      return next(current, event.at, {
        state: "POLL_WAIT",
        nextActionAt: event.nextActionAt
      });
    case "BEGIN_POLL":
      assertState(current, "POLL_WAIT");
      requireLease(current, event);
      if (current.activeAction !== "NONE") illegal();
      requireDue(current.nextActionAt, event.at);
      if (current.attempts.poll >= current.limits.poll) {
        return finalFailure(
          current,
          event.at,
          "POLL",
          "POLL_ATTEMPTS_EXHAUSTED"
        );
      }
      return next(current, event.at, {
        attempts: increment(current.attempts, "poll"),
        activeAction: "POLL",
        nextActionAt: null
      });
    case "POLL_PENDING":
      return pollPending(current, event);
    case "POLL_RESULT_READY":
      assertPolling(current, event);
      return next(current, event.at, {
        state: "RESULT_READY",
        activeAction: "NONE",
        nextActionAt: null,
        ...releasedLease()
      });
    case "POLL_FAILED":
      return repeatableActionFailed(current, event, "POLL");
    case "BEGIN_FETCH":
      assertState(current, "RESULT_READY");
      requireLease(current, event);
      if (current.attempts.fetch >= current.limits.fetch) {
        return finalFailure(
          current,
          event.at,
          "FETCH",
          "FETCH_ATTEMPTS_EXHAUSTED"
        );
      }
      return next(current, event.at, {
        state: "FETCHING",
        attempts: increment(current.attempts, "fetch")
      });
    case "FETCH_NORMALIZED":
      assertState(current, "FETCHING");
      requireLease(current, event);
      return next(current, event.at, {
        state: "NORMALIZED",
        resultFacts: event.resultFacts
      });
    case "FETCH_FAILED":
      return repeatableActionFailed(current, event, "FETCH");
    case "STAGE_RESULT":
      assertState(current, "NORMALIZED");
      requireLease(current, event);
      return next(current, event.at, {
        state: "STAGED",
        ...releasedLease()
      });
    case "BEGIN_PERSIST":
      assertState(current, "STAGED");
      requireLease(current, event);
      if (current.activeAction !== "NONE") illegal();
      if (current.attempts.persist >= current.limits.persist) {
        return finalFailure(
          current,
          event.at,
          "PERSIST",
          "PERSISTENCE_ATTEMPTS_EXHAUSTED"
        );
      }
      return next(current, event.at, {
        attempts: increment(current.attempts, "persist"),
        activeAction: "PERSIST"
      });
    case "PERSISTED":
      assertPersisting(current, event);
      return next(current, event.at, {
        state: "PERSISTED",
        activeAction: "NONE",
        ...releasedLease()
      });
    case "PERSIST_FAILED":
      assertPersisting(current, event);
      requireAtOrAfter(event.retryAt, event.at);
      return safeRetryOrExhausted(
        current,
        event.at,
        "PERSIST",
        "PERSISTENCE_TEMPORARY",
        "PERSISTENCE_ATTEMPTS_EXHAUSTED",
        event.retryAt
      );
    case "RETRY_DUE":
      return retryDue(current, event);
    case "CANCEL":
      return cancel(current, event.at);
  }
}

function claim(
  current: RankProviderLifecycleSnapshotV1,
  event: Extract<RankProviderLifecycleEventV1, { readonly type: "CLAIM" }>
): RankProviderLifecycleSnapshotV1 {
  if (millis(event.leaseExpiresAt) <= millis(event.at)) {
    fail("LEASE_CONFLICT", "Rank provider lease is already expired");
  }
  if (
    current.leaseExpiresAt !== null &&
    millis(event.at) < millis(current.leaseExpiresAt)
  ) {
    fail("LEASE_CONFLICT", "Rank provider lifecycle already has a lease");
  }
  if (current.state === "POLL_WAIT") {
    if (current.activeAction !== "NONE") illegal();
    requireDue(current.nextActionAt, event.at);
  }
  if (
    current.state === "RESULT_READY" ||
    current.state === "STAGED"
  ) {
    if (current.activeAction !== "NONE") illegal();
  }
  return next(current, event.at, {
    state: current.state === "READY_TO_SUBMIT" ? "CLAIMED" : current.state,
    leaseGeneration: current.leaseGeneration + 1,
    leaseOwner: event.leaseOwner,
    leaseToken: event.leaseToken,
    leaseExpiresAt: event.leaseExpiresAt
  });
}

function renewLease(
  current: RankProviderLifecycleSnapshotV1,
  event: Extract<
    RankProviderLifecycleEventV1,
    { readonly type: "RENEW_LEASE" }
  >
): RankProviderLifecycleSnapshotV1 {
  requireLease(current, event);
  if (
    current.leaseExpiresAt === null ||
    millis(event.leaseExpiresAt) <= millis(current.leaseExpiresAt)
  ) {
    fail("LEASE_CONFLICT", "Rank provider lease did not advance");
  }
  return next(current, event.at, {
    leaseExpiresAt: event.leaseExpiresAt
  });
}

function submitFailed(
  current: RankProviderLifecycleSnapshotV1,
  event: Extract<
    RankProviderLifecycleEventV1,
    { readonly type: "SUBMIT_FAILED" }
  >
): RankProviderLifecycleSnapshotV1 {
  assertState(current, "SUBMITTING");
  requireLease(current, event);

  switch (event.outcome) {
    case "LOCAL_PRE_SEND":
      // There is no durable pre-marker SUBMITTING state. Failures that are
      // still provably local happen while CLAIMED, before BEGIN_SUBMIT. Once
      // BEGIN_SUBMIT commits, recovery must assume the provider may have seen
      // the request.
      if (current.submitMayHaveStarted || event.retryAt === null) illegal();
      requireAtOrAfter(event.retryAt, event.at);
      return safeRetryOrExhausted(
        current,
        event.at,
        "SUBMIT",
        "SUBMIT_LOCAL_PRE_SEND",
        "SUBMIT_ATTEMPTS_EXHAUSTED",
        event.retryAt
      );
    case "EXPLICIT_429":
      if (event.retryAt === null) illegal();
      requireAtOrAfter(event.retryAt, event.at);
      return safeRetryOrExhausted(
        current,
        event.at,
        "SUBMIT",
        "SUBMIT_RATE_LIMITED",
        "SUBMIT_ATTEMPTS_EXHAUSTED",
        event.retryAt
      );
    case "AMBIGUOUS_TRANSPORT":
    case "AMBIGUOUS_5XX":
    case "INVALID_RESPONSE":
      if (event.retryAt !== null || !current.submitMayHaveStarted) illegal();
      return next(current, event.at, {
        state: "SUBMIT_OUTCOME_UNKNOWN",
        failure: {
          phase: "SUBMIT",
          code: "SUBMIT_OUTCOME_UNKNOWN"
        },
        nextActionAt: null,
        ...releasedLease()
      });
    case "FINAL_REJECTION":
      if (event.retryAt !== null) illegal();
      return finalFailure(
        current,
        event.at,
        "SUBMIT",
        "SUBMIT_REJECTED"
      );
  }
}

function recoverExpiredAction(
  current: RankProviderLifecycleSnapshotV1,
  event: Extract<
    RankProviderLifecycleEventV1,
    { readonly type: "RECOVER_EXPIRED_ACTION" }
  >
): RankProviderLifecycleSnapshotV1 {
  if (
    current.leaseExpiresAt === null ||
    millis(event.at) < millis(current.leaseExpiresAt)
  ) {
    fail("LEASE_CONFLICT", "Rank provider lease has not expired");
  }
  requireAtOrAfter(event.retryAt, event.at);

  switch (current.state) {
    case "CLAIMED":
      return next(current, event.at, {
        state: "READY_TO_SUBMIT",
        ...releasedLease()
      });
    case "SUBMITTING":
      if (!current.submitMayHaveStarted) invalidSnapshot();
      return next(current, event.at, {
        state: "SUBMIT_OUTCOME_UNKNOWN",
        failure: {
          phase: "SUBMIT",
          code: "SUBMIT_OUTCOME_UNKNOWN"
        },
        nextActionAt: null,
        ...releasedLease()
      });
    case "POLL_WAIT":
      if (current.activeAction === "NONE") {
        return next(current, event.at, releasedLease());
      }
      return providerRetryOrFinal(
        current,
        event.at,
        "POLL",
        "POLL_TEMPORARY",
        event.retryAt
      );
    case "RESULT_READY":
      return next(current, event.at, releasedLease());
    case "FETCHING":
    case "NORMALIZED":
      return providerRetryOrFinal(
        current,
        event.at,
        "FETCH",
        "FETCH_TEMPORARY",
        event.retryAt
      );
    case "STAGED":
      if (current.activeAction === "NONE") {
        return next(current, event.at, releasedLease());
      }
      return safeRetryOrExhausted(
        current,
        event.at,
        "PERSIST",
        "PERSISTENCE_TEMPORARY",
        "PERSISTENCE_ATTEMPTS_EXHAUSTED",
        event.retryAt
      );
    default:
      illegal();
  }
}

function pollPending(
  current: RankProviderLifecycleSnapshotV1,
  event: Extract<
    RankProviderLifecycleEventV1,
    { readonly type: "POLL_PENDING" }
  >
): RankProviderLifecycleSnapshotV1 {
  assertPolling(current, event);
  requireAtOrAfter(event.nextActionAt, event.at);
  if (!current.capabilities.pollRepeatabilityConfirmed) {
    return finalFailure(
      current,
      event.at,
      "POLL",
      "POLL_REPEATABILITY_UNCONFIRMED"
    );
  }
  if (current.attempts.poll >= current.limits.poll) {
    return finalFailure(
      current,
      event.at,
      "POLL",
      "POLL_ATTEMPTS_EXHAUSTED"
    );
  }
  return next(current, event.at, {
    activeAction: "NONE",
    nextActionAt: event.nextActionAt,
    ...releasedLease()
  });
}

function repeatableActionFailed(
  current: RankProviderLifecycleSnapshotV1,
  event: Extract<
    RankProviderLifecycleEventV1,
    { readonly type: "POLL_FAILED" | "FETCH_FAILED" }
  >,
  phase: "POLL" | "FETCH"
): RankProviderLifecycleSnapshotV1 {
  if (phase === "POLL") {
    assertPolling(
      current,
      event as Extract<
        RankProviderLifecycleEventV1,
        { readonly type: "POLL_FAILED" }
      >
    );
  } else {
    assertState(current, "FETCHING");
    requireLease(current, event);
  }
  if (event.outcome === "INVALID_RESPONSE") {
    if (event.retryAt !== null) illegal();
    return finalFailure(
      current,
      event.at,
      phase,
      phase === "POLL" ? "POLL_INVALID_RESPONSE" : "FETCH_INVALID_RESPONSE"
    );
  }
  if (event.outcome === "FINAL_REJECTION") {
    if (event.retryAt !== null) illegal();
    return finalFailure(
      current,
      event.at,
      phase,
      phase === "POLL" ? "POLL_REJECTED" : "FETCH_REJECTED"
    );
  }
  if (event.retryAt === null) illegal();
  requireAtOrAfter(event.retryAt, event.at);
  return providerRetryOrFinal(
    current,
    event.at,
    phase,
    phase === "POLL"
      ? event.outcome === "EXPLICIT_429"
        ? "POLL_RATE_LIMITED"
        : "POLL_TEMPORARY"
      : event.outcome === "EXPLICIT_429"
        ? "FETCH_RATE_LIMITED"
        : "FETCH_TEMPORARY",
    event.retryAt
  );
}

function providerRetryOrFinal(
  current: RankProviderLifecycleSnapshotV1,
  at: string,
  phase: "POLL" | "FETCH",
  retryCode:
    | "POLL_RATE_LIMITED"
    | "POLL_TEMPORARY"
    | "FETCH_RATE_LIMITED"
    | "FETCH_TEMPORARY",
  retryAt: string
): RankProviderLifecycleSnapshotV1 {
  const confirmed =
    phase === "POLL"
      ? current.capabilities.pollRepeatabilityConfirmed
      : current.capabilities.fetchRepeatabilityConfirmed;
  if (!confirmed) {
    return finalFailure(
      current,
      at,
      phase,
      phase === "POLL"
        ? "POLL_REPEATABILITY_UNCONFIRMED"
        : "FETCH_REPEATABILITY_UNCONFIRMED"
    );
  }
  return safeRetryOrExhausted(
    current,
    at,
    phase,
    retryCode,
    phase === "POLL"
      ? "POLL_ATTEMPTS_EXHAUSTED"
      : "FETCH_ATTEMPTS_EXHAUSTED",
    retryAt
  );
}

function retryDue(
  current: RankProviderLifecycleSnapshotV1,
  event: Extract<
    RankProviderLifecycleEventV1,
    { readonly type: "RETRY_DUE" }
  >
): RankProviderLifecycleSnapshotV1 {
  assertState(current, "FAILED_RETRYABLE");
  if (current.failure === null) invalidSnapshot();
  if (current.failure.phase === "SUBMIT") {
    // A retryable submit result schedules a new authoritative grant and a
    // new monotonic execution attempt. The expired grant/execution aggregate
    // must never return to READY_TO_SUBMIT for a second provider request.
    illegal();
  }
  if (
    !RETRYABLE_FAILURE_CODES[current.failure.phase].has(
      current.failure.code
    )
  ) {
    invalidSnapshot();
  }
  requireDue(current.nextActionAt, event.at);
  const common = {
    failure: null,
    nextActionAt: null,
    activeAction: "NONE" as const,
    ...releasedLease()
  };
  switch (current.failure.phase) {
    case "POLL":
      return next(current, event.at, {
        ...common,
        state: "POLL_WAIT",
        nextActionAt: event.at
      });
    case "FETCH":
      return next(current, event.at, {
        ...common,
        state: "RESULT_READY"
      });
    case "PERSIST":
      return next(current, event.at, {
        ...common,
        state: "STAGED"
      });
  }
}

function cancel(
  current: RankProviderLifecycleSnapshotV1,
  at: string
): RankProviderLifecycleSnapshotV1 {
  const safe =
    current.state === "READY_TO_SUBMIT" ||
    current.state === "CLAIMED" ||
    (current.state === "FAILED_RETRYABLE" &&
      current.failure?.phase === "SUBMIT");
  if (!safe) illegal();
  return next(current, at, {
    state: "CANCELLED",
    failure: null,
    nextActionAt: null,
    submitMayHaveStarted: false,
    ...releasedLease()
  });
}

function safeRetryOrExhausted(
  current: RankProviderLifecycleSnapshotV1,
  at: string,
  phase: RankProviderFailurePhase,
  retryCode: RankProviderFailureCode,
  exhaustedCode: RankProviderFailureCode,
  retryAt: string
): RankProviderLifecycleSnapshotV1 {
  const key = actionCountKey(phase);
  if (current.attempts[key] >= current.limits[key]) {
    return finalFailure(current, at, phase, exhaustedCode);
  }
  return next(current, at, {
    state: "FAILED_RETRYABLE",
    activeAction: "NONE",
    failure: { phase, code: retryCode },
    nextActionAt: retryAt,
    submitMayHaveStarted:
      phase === "SUBMIT" ? false : current.submitMayHaveStarted,
    resultFacts: phase === "FETCH" ? null : current.resultFacts,
    ...releasedLease()
  });
}

function finalFailure(
  current: RankProviderLifecycleSnapshotV1,
  at: string,
  phase: RankProviderFailurePhase,
  code: RankProviderFailureCode
): RankProviderLifecycleSnapshotV1 {
  return next(current, at, {
    state: "FAILED_FINAL",
    activeAction: "NONE",
    failure: { phase, code },
    nextActionAt: null,
    submitMayHaveStarted:
      phase === "SUBMIT" ? false : current.submitMayHaveStarted,
    resultFacts: phase === "FETCH" ? null : current.resultFacts,
    ...releasedLease()
  });
}

function assertPolling(
  current: RankProviderLifecycleSnapshotV1,
  event: RankProviderLeaseProof & { readonly at: string }
): void {
  assertState(current, "POLL_WAIT");
  requireLease(current, event);
  if (current.activeAction !== "POLL") illegal();
}

function assertPersisting(
  current: RankProviderLifecycleSnapshotV1,
  event: RankProviderLeaseProof & { readonly at: string }
): void {
  assertState(current, "STAGED");
  requireLease(current, event);
  if (current.activeAction !== "PERSIST") illegal();
}

function assertState<T extends RankProviderLifecycleState>(
  current: RankProviderLifecycleSnapshotV1,
  state: T
): asserts current is RankProviderLifecycleSnapshotV1 & {
  readonly state: T;
} {
  if (current.state !== state) illegal();
}

function requireLease(
  current: RankProviderLifecycleSnapshotV1,
  proof: RankProviderLeaseProof & { readonly at: string }
): void {
  if (
    current.leaseOwner === null ||
    current.leaseToken === null ||
    current.leaseExpiresAt === null ||
    current.leaseOwner !== proof.leaseOwner ||
    current.leaseToken !== proof.leaseToken ||
    current.leaseGeneration !== proof.leaseGeneration ||
    millis(proof.at) >= millis(current.leaseExpiresAt)
  ) {
    fail("LEASE_CONFLICT", "Rank provider lifecycle lease conflict");
  }
}

function requireDue(value: string | null, at: string): void {
  if (value === null || millis(at) < millis(value)) {
    fail("NOT_DUE", "Rank provider lifecycle action is not due");
  }
}

function requireAtOrAfter(value: string, at: string): void {
  if (millis(value) < millis(at)) {
    fail("ILLEGAL_TRANSITION", "Rank provider lifecycle deadline regressed");
  }
}

function next(
  current: RankProviderLifecycleSnapshotV1,
  at: string,
  patch: Partial<RankProviderLifecycleSnapshotV1>
): RankProviderLifecycleSnapshotV1 {
  return rankProviderLifecycleSnapshot({
    ...current,
    ...patch,
    schemaVersion: RANK_PROVIDER_LIFECYCLE_SCHEMA,
    version: current.version + 1,
    updatedAt: at
  });
}

function releasedLease(): Pick<
  RankProviderLifecycleSnapshotV1,
  "leaseOwner" | "leaseToken" | "leaseExpiresAt"
> {
  return { leaseOwner: null, leaseToken: null, leaseExpiresAt: null };
}

function increment(
  value: RankProviderActionCounts,
  key: keyof RankProviderActionCounts
): RankProviderActionCounts {
  return { ...value, [key]: value[key] + 1 };
}

function actionCountKey(
  phase: RankProviderFailurePhase
): keyof RankProviderActionCounts {
  switch (phase) {
    case "SUBMIT":
      return "submit";
    case "POLL":
      return "poll";
    case "FETCH":
      return "fetch";
    case "PERSIST":
      return "persist";
  }
}

function validateSnapshotShape(
  value: RankProviderLifecycleSnapshotV1
): void {
  const hasLease = value.leaseOwner !== null;
  if (
    hasLease !== (value.leaseToken !== null) ||
    hasLease !== (value.leaseExpiresAt !== null) ||
    (hasLease && value.leaseGeneration < 1) ||
    (!hasLease && value.activeAction !== "NONE") ||
    (hasLease &&
      value.leaseExpiresAt !== null &&
      millis(value.leaseExpiresAt) <= millis(value.updatedAt))
  ) {
    invalidSnapshot();
  }

  if (
    (value.providerTaskId !== null && value.attempts.submit < 1) ||
    (value.providerTaskId !== null && !value.submitMayHaveStarted) ||
    (value.resultFacts !== null && value.attempts.fetch < 1)
  ) {
    invalidSnapshot();
  }

  const taskRequired = new Set<RankProviderLifecycleState>([
    "SUBMITTED",
    "POLL_WAIT",
    "RESULT_READY",
    "FETCHING",
    "NORMALIZED",
    "STAGED",
    "PERSISTED"
  ]);
  const resultRequired = new Set<RankProviderLifecycleState>([
    "NORMALIZED",
    "STAGED",
    "PERSISTED"
  ]);
  if (
    (taskRequired.has(value.state) && value.providerTaskId === null) ||
    (resultRequired.has(value.state) && value.resultFacts === null)
  ) {
    invalidSnapshot();
  }

  if (value.failure !== null) {
    const taskByFailure = value.failure.phase !== "SUBMIT";
    const resultByFailure = value.failure.phase === "PERSIST";
    if (
      taskByFailure !== (value.providerTaskId !== null) ||
      resultByFailure !== (value.resultFacts !== null)
    ) {
      invalidSnapshot();
    }
  }

  switch (value.state) {
    case "READY_TO_SUBMIT":
      requireShape(value, {
        lease: false,
        task: false,
        result: false,
        failure: false,
        nextAction: false,
        action: "NONE"
      });
      if (value.submitMayHaveStarted) invalidSnapshot();
      break;
    case "CLAIMED":
      requireShape(value, {
        lease: true,
        task: false,
        result: false,
        failure: false,
        nextAction: false,
        action: "NONE"
      });
      if (value.submitMayHaveStarted) invalidSnapshot();
      break;
    case "SUBMITTING":
      requireShape(value, {
        lease: true,
        task: false,
        result: false,
        failure: false,
        nextAction: false,
        action: "NONE"
      });
      if (value.attempts.submit < 1 || !value.submitMayHaveStarted) {
        invalidSnapshot();
      }
      break;
    case "SUBMIT_OUTCOME_UNKNOWN":
      requireShape(value, {
        lease: false,
        task: false,
        result: false,
        failure: true,
        nextAction: false,
        action: "NONE"
      });
      if (value.failure?.code !== "SUBMIT_OUTCOME_UNKNOWN") {
        invalidSnapshot();
      }
      if (value.attempts.submit < 1 || !value.submitMayHaveStarted) {
        invalidSnapshot();
      }
      break;
    case "SUBMITTED":
      requireShape(value, {
        lease: false,
        task: true,
        result: false,
        failure: false,
        nextAction: false,
        action: "NONE"
      });
      break;
    case "POLL_WAIT":
      requireShape(value, {
        lease: hasLease,
        task: true,
        result: false,
        failure: false,
        nextAction: value.activeAction === "NONE",
        action: value.activeAction
      });
      if (value.activeAction !== "NONE" && value.activeAction !== "POLL") {
        invalidSnapshot();
      }
      break;
    case "RESULT_READY":
      requireShape(value, {
        lease: hasLease,
        task: true,
        result: false,
        failure: false,
        nextAction: false,
        action: "NONE"
      });
      if (value.attempts.poll < 1) invalidSnapshot();
      break;
    case "FETCHING":
      requireShape(value, {
        lease: true,
        task: true,
        result: false,
        failure: false,
        nextAction: false,
        action: "NONE"
      });
      if (value.attempts.poll < 1 || value.attempts.fetch < 1) {
        invalidSnapshot();
      }
      break;
    case "NORMALIZED":
      requireShape(value, {
        lease: true,
        task: true,
        result: true,
        failure: false,
        nextAction: false,
        action: "NONE"
      });
      break;
    case "STAGED":
      requireShape(value, {
        lease: hasLease,
        task: true,
        result: true,
        failure: false,
        nextAction: false,
        action: value.activeAction
      });
      if (value.activeAction !== "NONE" && value.activeAction !== "PERSIST") {
        invalidSnapshot();
      }
      break;
    case "PERSISTED":
      requireShape(value, {
        lease: false,
        task: true,
        result: true,
        failure: false,
        nextAction: false,
        action: "NONE"
      });
      if (value.attempts.persist < 1) invalidSnapshot();
      break;
    case "FAILED_RETRYABLE":
      requireShape(value, {
        lease: false,
        task: value.failure?.phase !== "SUBMIT",
        result: value.failure?.phase === "PERSIST",
        failure: true,
        nextAction: true,
        action: "NONE"
      });
      validateFailureState(value, "RETRYABLE");
      break;
    case "FAILED_FINAL":
      requireShape(value, {
        lease: false,
        task: value.failure?.phase !== "SUBMIT",
        result: value.failure?.phase === "PERSIST",
        failure: true,
        nextAction: false,
        action: "NONE"
      });
      validateFailureState(value, "FINAL");
      break;
    case "CANCELLED":
      requireShape(value, {
        lease: false,
        task: false,
        result: false,
        failure: false,
        nextAction: false,
        action: "NONE"
      });
      if (value.submitMayHaveStarted) invalidSnapshot();
      break;
  }
}

function requireShape(
  value: RankProviderLifecycleSnapshotV1,
  expected: {
    readonly lease: boolean;
    readonly task: boolean;
    readonly result: boolean;
    readonly failure: boolean;
    readonly nextAction: boolean;
    readonly action: RankProviderLifecycleSnapshotV1["activeAction"];
  }
): void {
  if (
    (value.leaseOwner !== null) !== expected.lease ||
    (value.providerTaskId !== null) !== expected.task ||
    (value.resultFacts !== null) !== expected.result ||
    (value.failure !== null) !== expected.failure ||
    (value.nextActionAt !== null) !== expected.nextAction ||
    value.activeAction !== expected.action
  ) {
    invalidSnapshot();
  }
}

function validateFailureState(
  value: RankProviderLifecycleSnapshotV1,
  kind: "RETRYABLE" | "FINAL"
): void {
  const failure = value.failure;
  if (failure === null) invalidSnapshot();
  const allowed =
    kind === "RETRYABLE"
      ? RETRYABLE_FAILURE_CODES[failure.phase]
      : FINAL_FAILURE_CODES[failure.phase];
  if (!allowed.has(failure.code)) invalidSnapshot();

  const key = actionCountKey(failure.phase);
  const attempts = value.attempts[key];
  const limit = value.limits[key];
  if (
    attempts < 1 ||
    (kind === "RETRYABLE" && attempts >= limit) ||
    (failure.phase === "SUBMIT" && value.submitMayHaveStarted)
  ) {
    invalidSnapshot();
  }

  if (
    kind === "RETRYABLE" &&
    ((failure.phase === "POLL" &&
      !value.capabilities.pollRepeatabilityConfirmed) ||
      (failure.phase === "FETCH" &&
        !value.capabilities.fetchRepeatabilityConfirmed))
  ) {
    invalidSnapshot();
  }

  if (
    (failure.code === "SUBMIT_ATTEMPTS_EXHAUSTED" ||
      failure.code === "POLL_ATTEMPTS_EXHAUSTED" ||
      failure.code === "FETCH_ATTEMPTS_EXHAUSTED" ||
      failure.code === "PERSISTENCE_ATTEMPTS_EXHAUSTED") &&
    attempts !== limit
  ) {
    invalidSnapshot();
  }

  if (
    (failure.code === "POLL_REPEATABILITY_UNCONFIRMED" &&
      value.capabilities.pollRepeatabilityConfirmed) ||
    (failure.code === "FETCH_REPEATABILITY_UNCONFIRMED" &&
      value.capabilities.fetchRepeatabilityConfirmed)
  ) {
    invalidSnapshot();
  }
}

function failureFact(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): RankProviderFailureFact {
  const input = exactRecord(value, ["phase", "code"], code);
  if (
    typeof input.phase !== "string" ||
    !PHASE_SET.has(input.phase) ||
    typeof input.code !== "string" ||
    !FAILURE_CODE_SET.has(input.code)
  ) {
    invalid(code);
  }
  const fact = {
    phase: input.phase as RankProviderFailurePhase,
    code: input.code as RankProviderFailureCode
  };
  if (failurePhaseForCode(fact.code) !== fact.phase) invalid(code);
  return fact;
}

function failurePhaseForCode(
  code: RankProviderFailureCode
): RankProviderFailurePhase {
  if (code.startsWith("SUBMIT_")) return "SUBMIT";
  if (code.startsWith("POLL_")) return "POLL";
  if (code.startsWith("FETCH_")) return "FETCH";
  return "PERSIST";
}

function resultFacts(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): RankProviderResultFactsV1 {
  const input = exactRecord(
    value,
    ["schemaVersion", "normalizedPayloadSha256", "rowCount"],
    code
  );
  if (
    input.schemaVersion !== RANK_PROVIDER_RESULT_FACTS_SCHEMA ||
    typeof input.normalizedPayloadSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(input.normalizedPayloadSha256)
  ) {
    invalid(code);
  }
  return {
    schemaVersion: RANK_PROVIDER_RESULT_FACTS_SCHEMA,
    normalizedPayloadSha256: input.normalizedPayloadSha256,
    rowCount: nonnegativeInteger(input.rowCount, code)
  };
}

function contractCapabilities(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): RankProviderContractCapabilitiesV1 {
  const input = exactRecord(
    value,
    [
      "schemaVersion",
      "pollRepeatabilityConfirmed",
      "fetchRepeatabilityConfirmed"
    ],
    code
  );
  if (
    input.schemaVersion !== RANK_PROVIDER_CONTRACT_CAPABILITIES_SCHEMA ||
    typeof input.pollRepeatabilityConfirmed !== "boolean" ||
    typeof input.fetchRepeatabilityConfirmed !== "boolean"
  ) {
    invalid(code);
  }
  return {
    schemaVersion: RANK_PROVIDER_CONTRACT_CAPABILITIES_SCHEMA,
    pollRepeatabilityConfirmed: input.pollRepeatabilityConfirmed,
    fetchRepeatabilityConfirmed: input.fetchRepeatabilityConfirmed
  };
}

const actionCountKeys = ["submit", "poll", "fetch", "persist"] as const;

function actionCounts(
  value: unknown,
  allowZero: boolean,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): RankProviderActionCounts {
  const input = exactRecord(value, actionCountKeys, code);
  const result = {
    submit: boundedInteger(input.submit, allowZero, code),
    poll: boundedInteger(input.poll, allowZero, code),
    fetch: boundedInteger(input.fetch, allowZero, code),
    persist: boundedInteger(input.persist, allowZero, code)
  };
  return result;
}

function boundedInteger(
  value: unknown,
  allowZero: boolean,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): number {
  const parsed = nonnegativeInteger(value, code);
  if ((!allowZero && parsed === 0) || parsed > 1_000) invalid(code);
  return parsed;
}

function positiveInteger(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): number {
  const parsed = nonnegativeInteger(value, code);
  if (parsed < 1) invalid(code);
  return parsed;
}

function nonnegativeInteger(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(code);
  return Number(value);
}

function eventBase(
  value: Readonly<Record<string, unknown>>,
  type: RankProviderLifecycleEventType
): RankProviderLifecycleEventBase {
  return {
    schemaVersion: RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA,
    type,
    expectedVersion: positiveInteger(value.expectedVersion, "INVALID_EVENT"),
    at: timestamp(value.at, "INVALID_EVENT")
  };
}

function eventRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  return exactRecord(
    value,
    ["schemaVersion", "type", "expectedVersion", "at", ...fields],
    "INVALID_EVENT"
  );
}

function leaseProof(
  value: Readonly<Record<string, unknown>>
): RankProviderLeaseProof {
  return {
    leaseOwner: leaseOwner(value.leaseOwner, "INVALID_EVENT"),
    leaseToken: leaseToken(value.leaseToken, "INVALID_EVENT"),
    leaseGeneration: positiveInteger(
      value.leaseGeneration,
      "INVALID_EVENT"
    )
  };
}

function timestamp(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): string {
  if (typeof value !== "string") invalid(code);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    invalid(code);
  }
  return value;
}

function nullableTimestamp(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): string | null {
  return value === null ? null : timestamp(value, code);
}

function millis(value: string): number {
  return new Date(value).getTime();
}

function leaseOwner(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/u.test(value)
  ) {
    invalid(code);
  }
  return value;
}

function nullableLeaseOwner(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): string | null {
  return value === null ? null : leaseOwner(value, code);
}

function leaseToken(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  ) {
    invalid(code);
  }
  return value;
}

function nullableLeaseToken(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): string | null {
  return value === null ? null : leaseToken(value, code);
}

function providerTaskId(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
  ) {
    invalid(code);
  }
  return value;
}

function nullableProviderTaskId(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): string | null {
  return value === null ? null : providerTaskId(value, code);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): Readonly<Record<string, unknown>> {
  const input = record(value, code);
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !(field in input))
  ) {
    invalid(code);
  }
  return input;
}

function record(
  value: unknown,
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(code);
  }
  return value as Readonly<Record<string, unknown>>;
}

function invalid(
  code: "INVALID_SNAPSHOT" | "INVALID_EVENT"
): never {
  if (code === "INVALID_SNAPSHOT") invalidSnapshot();
  return invalidEvent();
}

function invalidSnapshot(): never {
  throw new RankProviderLifecycleError(
    "INVALID_SNAPSHOT",
    "Invalid stored rank provider lifecycle"
  );
}

function invalidEvent(): never {
  throw new RankProviderLifecycleError(
    "INVALID_EVENT",
    "Invalid rank provider lifecycle event"
  );
}

function illegal(): never {
  return fail(
    "ILLEGAL_TRANSITION",
    "Rank provider lifecycle transition is not allowed"
  );
}

function fail(code: RankProviderLifecycleErrorCode, message: string): never {
  throw new RankProviderLifecycleError(code, message);
}
