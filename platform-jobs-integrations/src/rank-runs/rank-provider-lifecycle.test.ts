import assert from "node:assert/strict";
import test from "node:test";
import {
  RANK_PROVIDER_CONTRACT_CAPABILITIES_SCHEMA,
  RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA,
  RANK_PROVIDER_LIFECYCLE_INIT_SCHEMA,
  RANK_PROVIDER_LIFECYCLE_SCHEMA,
  RANK_PROVIDER_RESULT_FACTS_SCHEMA,
  RankProviderLifecycleError,
  createRankProviderLifecycle,
  rankProviderLifecycleEvent,
  rankProviderLifecycleEventTypes,
  rankProviderLifecycleSnapshot,
  rankProviderLifecycleStates,
  rankProviderLifecycleTransitionMatrix,
  reduceRankProviderLifecycle,
  type RankProviderLifecycleErrorCode,
  type RankProviderLifecycleEventType,
  type RankProviderLifecycleSnapshotV1
} from "./rank-provider-lifecycle.js";

const BASE_TIME = Date.parse("2026-07-30T08:00:00.000Z");
const NORMALIZED_HASH = "ab".repeat(32);

test("defines an exhaustive explicit transition allowlist", () => {
  assert.deepEqual(Object.keys(rankProviderLifecycleTransitionMatrix), [
    ...rankProviderLifecycleStates
  ]);
  assert.deepEqual(rankProviderLifecycleTransitionMatrix, {
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
  });

  const covered = new Set(
    Object.values(rankProviderLifecycleTransitionMatrix).flat()
  );
  assert.deepEqual([...covered].sort(), [
    ...rankProviderLifecycleEventTypes
  ].sort());
  for (const transitions of Object.values(
    rankProviderLifecycleTransitionMatrix
  )) {
    assert.equal(new Set(transitions).size, transitions.length);
  }
});

test("runs the complete accepted submit, poll, fetch, stage and persist path", () => {
  const flow = new Flow({
    pollRepeatabilityConfirmed: true,
    fetchRepeatabilityConfirmed: true
  });
  assert.equal(flow.snapshot.state, "READY_TO_SUBMIT");

  flow.claim();
  assert.equal(flow.snapshot.state, "CLAIMED");
  const firstGeneration = flow.snapshot.leaseGeneration;
  const firstExpiry = flow.snapshot.leaseExpiresAt;
  flow.event("RENEW_LEASE", {
    ...flow.leaseProof(),
    leaseExpiresAt: flow.time(flow.second + 60)
  });
  assert.equal(flow.snapshot.leaseGeneration, firstGeneration);
  assert.notEqual(flow.snapshot.leaseExpiresAt, firstExpiry);

  flow.event("BEGIN_SUBMIT", flow.leaseProof());
  assert.equal(flow.snapshot.state, "SUBMITTING");
  assert.equal(flow.snapshot.attempts.submit, 1);
  assert.equal(flow.snapshot.submitMayHaveStarted, true);
  flow.event("SUBMIT_ACCEPTED", {
    ...flow.leaseProof(),
    providerTaskId: "provider-task-001"
  });
  assert.equal(flow.snapshot.state, "SUBMITTED");
  assert.equal(flow.snapshot.providerTaskId, "provider-task-001");

  flow.event("SCHEDULE_POLL", {
    nextActionAt: flow.time(flow.second + 2)
  });
  flow.claim("connector-b", 30, flow.second + 2);
  flow.event("BEGIN_POLL", flow.leaseProof());
  flow.event("POLL_PENDING", {
    ...flow.leaseProof(),
    nextActionAt: flow.time(flow.second + 2)
  });
  assert.equal(flow.snapshot.state, "POLL_WAIT");
  assert.equal(flow.snapshot.attempts.poll, 1);

  flow.claim("connector-c", 30, flow.second + 2);
  flow.event("BEGIN_POLL", flow.leaseProof());
  flow.event("POLL_RESULT_READY", flow.leaseProof());
  assert.equal(flow.snapshot.state, "RESULT_READY");
  assert.equal(flow.snapshot.attempts.poll, 2);

  flow.claim("connector-d");
  flow.event("BEGIN_FETCH", flow.leaseProof());
  flow.event("FETCH_NORMALIZED", {
    ...flow.leaseProof(),
    resultFacts: normalizedFacts(250)
  });
  assert.equal(flow.snapshot.state, "NORMALIZED");
  flow.event("STAGE_RESULT", flow.leaseProof());
  assert.equal(flow.snapshot.state, "STAGED");

  flow.claim("connector-e");
  flow.event("BEGIN_PERSIST", flow.leaseProof());
  flow.event("PERSISTED", flow.leaseProof());
  assert.equal(flow.snapshot.state, "PERSISTED");
  assert.deepEqual(flow.snapshot.attempts, {
    submit: 1,
    poll: 2,
    fetch: 1,
    persist: 1
  });
  assert.deepEqual(flow.snapshot.resultFacts, normalizedFacts(250));
  assert.equal(flow.snapshot.providerTaskId, "provider-task-001");
  assert.equal(flow.snapshot.leaseGeneration, 5);
  assert.equal(flow.snapshot.leaseOwner, null);
});

test("makes post-authorization ambiguity terminal and never auto-resubmits", () => {
  for (const outcome of [
    "AMBIGUOUS_TRANSPORT",
    "AMBIGUOUS_5XX",
    "INVALID_RESPONSE"
  ] as const) {
    const flow = new Flow();
    reachSubmitting(flow);
    flow.event("SUBMIT_FAILED", {
      ...flow.leaseProof(),
      outcome,
      retryAt: null
    });

    assert.equal(flow.snapshot.state, "SUBMIT_OUTCOME_UNKNOWN");
    assert.deepEqual(flow.snapshot.failure, {
      phase: "SUBMIT",
      code: "SUBMIT_OUTCOME_UNKNOWN"
    });
    assert.equal(flow.snapshot.nextActionAt, null);
    assert.equal(flow.snapshot.leaseOwner, null);
    assertLifecycleError(
      () =>
        flow.event("CLAIM", {
          leaseOwner: "connector-retry",
          leaseToken: leaseToken(99),
          leaseExpiresAt: flow.time(flow.second + 30)
        }),
      "ILLEGAL_TRANSITION"
    );
    assertLifecycleError(
      () => flow.event("RETRY_DUE"),
      "ILLEGAL_TRANSITION"
    );
    assertLifecycleError(
      () => flow.event("CANCEL"),
      "ILLEGAL_TRANSITION"
    );
  }
});

test("rejects forged retryable snapshots for ambiguous or invalid submit outcomes", () => {
  for (const outcome of [
    "AMBIGUOUS_TRANSPORT",
    "AMBIGUOUS_5XX",
    "INVALID_RESPONSE"
  ] as const) {
    const flow = new Flow();
    reachSubmitting(flow);
    flow.event("SUBMIT_FAILED", {
      ...flow.leaseProof(),
      outcome,
      retryAt: null
    });
    const unknown = flow.snapshot;
    const retryAt = flow.time(flow.second + 2);
    assertLifecycleError(
      () =>
        rankProviderLifecycleSnapshot({
          ...unknown,
          submitMayHaveStarted: false
        }),
      "INVALID_SNAPSHOT"
    );
    const forgedUnknownCode = {
      ...unknown,
      state: "FAILED_RETRYABLE",
      nextActionAt: retryAt
    };
    const forgedPreSend = {
      ...forgedUnknownCode,
      failure: {
        phase: "SUBMIT",
        code: "SUBMIT_LOCAL_PRE_SEND"
      }
    };
    const forgedRateLimit = {
      ...forgedUnknownCode,
      failure: {
        phase: "SUBMIT",
        code: "SUBMIT_RATE_LIMITED"
      }
    };

    for (const forged of [
      forgedUnknownCode,
      forgedPreSend,
      forgedRateLimit
    ]) {
      assertLifecycleError(
        () => rankProviderLifecycleSnapshot(forged),
        "INVALID_SNAPSHOT"
      );
      assertLifecycleError(
        () =>
          reduceRankProviderLifecycle(forged, {
            schemaVersion: RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA,
            type: "RETRY_DUE",
            expectedVersion: forged.version,
            at: retryAt
          }),
        "INVALID_SNAPSHOT"
      );
    }
  }
});

test("rejects READY or CLAIMED snapshots carrying an unresolved submit marker", () => {
  const ready = createRankProviderLifecycle(initialInput());
  assertLifecycleError(
    () =>
      rankProviderLifecycleSnapshot({
        ...ready,
        submitMayHaveStarted: true
      }),
    "INVALID_SNAPSHOT"
  );

  const flow = new Flow();
  flow.claim();
  assertLifecycleError(
    () =>
      rankProviderLifecycleSnapshot({
        ...flow.snapshot,
        submitMayHaveStarted: true
      }),
    "INVALID_SNAPSHOT"
  );

  const submitted = new Flow();
  reachSubmitted(submitted);
  assertLifecycleError(
    () =>
      rankProviderLifecycleSnapshot({
        ...submitted.snapshot,
        submitMayHaveStarted: false
      }),
    "INVALID_SNAPSHOT"
  );
});

test("schedules an explicit 429 for a new execution attempt", () => {
  const flow = new Flow();
  reachSubmitting(flow);
  const retryAt = flow.second + 2;
  flow.event("SUBMIT_FAILED", {
    ...flow.leaseProof(),
    outcome: "EXPLICIT_429",
    retryAt: flow.time(retryAt)
  });
  assert.equal(flow.snapshot.state, "FAILED_RETRYABLE");
  assert.equal(flow.snapshot.failure?.code, "SUBMIT_RATE_LIMITED");
  assert.equal(flow.snapshot.submitMayHaveStarted, false);
  assert.equal(flow.snapshot.nextActionAt, flow.time(retryAt));
  assert.equal(flow.snapshot.attempts.submit, 1);
  assertLifecycleError(
    () => flow.event("RETRY_DUE", {}, retryAt),
    "ILLEGAL_TRANSITION"
  );
});

test("rejects final-rejection code injection into retryable state", () => {
  const final = new Flow();
  reachSubmitting(final);
  final.event("SUBMIT_FAILED", {
    ...final.leaseProof(),
    outcome: "FINAL_REJECTION",
    retryAt: null
  });
  assert.equal(final.snapshot.state, "FAILED_FINAL");
  assert.equal(final.snapshot.submitMayHaveStarted, false);

  const forged = {
    ...final.snapshot,
    state: "FAILED_RETRYABLE",
    nextActionAt: final.time(final.second + 2)
  };
  assertLifecycleError(
    () => rankProviderLifecycleSnapshot(forged),
    "INVALID_SNAPSHOT"
  );
  assertLifecycleError(
    () =>
      reduceRankProviderLifecycle(forged, {
        schemaVersion: RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA,
        type: "RETRY_DUE",
        expectedVersion: forged.version,
        at: forged.nextActionAt
      }),
    "INVALID_SNAPSHOT"
  );
});

test("recovers before authorize but makes an expired authorized submit unknown", () => {
  const beforeAuthorize = new Flow(undefined, undefined, 2);
  beforeAuthorize.claim("connector-submit", 2);
  beforeAuthorize.event(
    "RECOVER_EXPIRED_ACTION",
    { retryAt: beforeAuthorize.time(10) },
    3
  );
  assert.equal(beforeAuthorize.snapshot.state, "READY_TO_SUBMIT");
  assert.equal(beforeAuthorize.snapshot.submitMayHaveStarted, false);

  const afterAuthorize = new Flow(undefined, undefined, 3);
  reachSubmitting(afterAuthorize, 3);
  afterAuthorize.event(
    "RECOVER_EXPIRED_ACTION",
    { retryAt: afterAuthorize.time(10) },
    4
  );
  assert.equal(afterAuthorize.snapshot.state, "SUBMIT_OUTCOME_UNKNOWN");
  assert.equal(
    afterAuthorize.snapshot.failure?.code,
    "SUBMIT_OUTCOME_UNKNOWN"
  );
  assert.equal(afterAuthorize.snapshot.submitMayHaveStarted, true);
});

test("never retries an explicit-429 submit in the same execution", () => {
  const limited = new Flow(undefined, {
    submit: 2,
    poll: 3,
    fetch: 2,
    persist: 2
  });
  reachSubmitting(limited);
  const firstRetry = limited.second + 2;
  limited.event("SUBMIT_FAILED", {
    ...limited.leaseProof(),
    outcome: "EXPLICIT_429",
    retryAt: limited.time(firstRetry)
  });
  assert.equal(limited.snapshot.state, "FAILED_RETRYABLE");
  assert.equal(limited.snapshot.submitMayHaveStarted, false);
  assertLifecycleError(
    () => limited.event("RETRY_DUE", {}, firstRetry),
    "ILLEGAL_TRANSITION"
  );
  assert.equal(limited.snapshot.attempts.submit, 1);

  const unsafe = new Flow();
  reachSubmitting(unsafe);
  assertLifecycleError(
    () =>
      unsafe.event("SUBMIT_FAILED", {
        ...unsafe.leaseProof(),
        outcome: "LOCAL_PRE_SEND",
        retryAt: unsafe.time(unsafe.second + 2)
      }),
    "ILLEGAL_TRANSITION"
  );
});

test("keeps poll and fetch retry disabled until recorded contract capabilities opt in", () => {
  const poll = new Flow();
  reachPolling(poll);
  poll.event("POLL_PENDING", {
    ...poll.leaseProof(),
    nextActionAt: poll.time(poll.second + 2)
  });
  assert.equal(poll.snapshot.state, "FAILED_FINAL");
  assert.deepEqual(poll.snapshot.failure, {
    phase: "POLL",
    code: "POLL_REPEATABILITY_UNCONFIRMED"
  });

  const fetch = new Flow({
    pollRepeatabilityConfirmed: true,
    fetchRepeatabilityConfirmed: false
  });
  reachFetching(fetch);
  fetch.event("FETCH_FAILED", {
    ...fetch.leaseProof(),
    outcome: "TEMPORARY",
    retryAt: fetch.time(fetch.second + 2)
  });
  assert.equal(fetch.snapshot.state, "FAILED_FINAL");
  assert.deepEqual(fetch.snapshot.failure, {
    phase: "FETCH",
    code: "FETCH_REPEATABILITY_UNCONFIRMED"
  });

  const enabled = new Flow({
    pollRepeatabilityConfirmed: true,
    fetchRepeatabilityConfirmed: true
  });
  reachPolling(enabled);
  const retryAt = enabled.second + 3;
  enabled.event("POLL_FAILED", {
    ...enabled.leaseProof(),
    outcome: "EXPLICIT_429",
    retryAt: enabled.time(retryAt)
  });
  assert.equal(enabled.snapshot.state, "FAILED_RETRYABLE");
  assert.equal(enabled.snapshot.failure?.code, "POLL_RATE_LIMITED");
  enabled.event("RETRY_DUE", {}, retryAt);
  assert.equal(enabled.snapshot.state, "POLL_WAIT");
});

test("rejects forged poll/fetch retries when repeatability is default-closed", () => {
  const poll = new Flow({
    pollRepeatabilityConfirmed: true,
    fetchRepeatabilityConfirmed: true
  });
  reachPolling(poll);
  poll.event("POLL_FAILED", {
    ...poll.leaseProof(),
    outcome: "TEMPORARY",
    retryAt: poll.time(poll.second + 2)
  });
  const forgedPoll = {
    ...poll.snapshot,
    capabilities: {
      ...poll.snapshot.capabilities,
      pollRepeatabilityConfirmed: false
    }
  };
  assertLifecycleError(
    () => rankProviderLifecycleSnapshot(forgedPoll),
    "INVALID_SNAPSHOT"
  );
  assertLifecycleError(
    () =>
      reduceRankProviderLifecycle(forgedPoll, {
        schemaVersion: RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA,
        type: "RETRY_DUE",
        expectedVersion: forgedPoll.version,
        at: forgedPoll.nextActionAt
      }),
    "INVALID_SNAPSHOT"
  );
  assertLifecycleError(
    () =>
      rankProviderLifecycleSnapshot({
        ...poll.snapshot,
        attempts: {
          ...poll.snapshot.attempts,
          poll: 0
        }
      }),
    "INVALID_SNAPSHOT"
  );
  assertLifecycleError(
    () =>
      rankProviderLifecycleSnapshot({
        ...poll.snapshot,
        attempts: {
          ...poll.snapshot.attempts,
          poll: poll.snapshot.limits.poll
        }
      }),
    "INVALID_SNAPSHOT"
  );

  const fetch = new Flow({
    pollRepeatabilityConfirmed: true,
    fetchRepeatabilityConfirmed: true
  });
  reachFetching(fetch);
  fetch.event("FETCH_FAILED", {
    ...fetch.leaseProof(),
    outcome: "TEMPORARY",
    retryAt: fetch.time(fetch.second + 2)
  });
  const forgedFetch = {
    ...fetch.snapshot,
    capabilities: {
      ...fetch.snapshot.capabilities,
      fetchRepeatabilityConfirmed: false
    }
  };
  assertLifecycleError(
    () => rankProviderLifecycleSnapshot(forgedFetch),
    "INVALID_SNAPSHOT"
  );
});

test("retries internal persistence safely and within its own bound", () => {
  const flow = new Flow(
    {
      pollRepeatabilityConfirmed: true,
      fetchRepeatabilityConfirmed: true
    },
    { submit: 2, poll: 3, fetch: 2, persist: 2 }
  );
  reachStaged(flow);
  flow.claim("persist-a");
  flow.event("BEGIN_PERSIST", flow.leaseProof());
  const retryAt = flow.second + 2;
  flow.event("PERSIST_FAILED", {
    ...flow.leaseProof(),
    retryAt: flow.time(retryAt)
  });
  assert.equal(flow.snapshot.state, "FAILED_RETRYABLE");
  assert.equal(flow.snapshot.failure?.code, "PERSISTENCE_TEMPORARY");
  assert.deepEqual(flow.snapshot.resultFacts, normalizedFacts(250));

  flow.event("RETRY_DUE", {}, retryAt);
  flow.claim("persist-b");
  flow.event("BEGIN_PERSIST", flow.leaseProof());
  flow.event("PERSIST_FAILED", {
    ...flow.leaseProof(),
    retryAt: flow.time(flow.second + 2)
  });
  assert.equal(flow.snapshot.state, "FAILED_FINAL");
  assert.equal(
    flow.snapshot.failure?.code,
    "PERSISTENCE_ATTEMPTS_EXHAUSTED"
  );
  assert.deepEqual(flow.snapshot.resultFacts, normalizedFacts(250));
});

test("fences lease owners, advances claims monotonically and rejects stale versions", () => {
  const flow = new Flow();
  flow.claim("connector-a", 5);
  assert.equal(flow.snapshot.leaseGeneration, 1);

  assertLifecycleError(
    () =>
      flow.event("CLAIM", {
        leaseOwner: "connector-b",
        leaseToken: leaseToken(2),
        leaseExpiresAt: flow.time(flow.second + 20)
      }),
    "ILLEGAL_TRANSITION"
  );
  assertLifecycleError(
    () =>
      flow.event("BEGIN_SUBMIT", {
        ...flow.leaseProof(),
        leaseOwner: "connector-b"
      }),
    "LEASE_CONFLICT"
  );
  assertLifecycleError(
    () =>
      flow.event("BEGIN_SUBMIT", {
        ...flow.leaseProof(),
        leaseToken: leaseToken(99)
      }),
    "LEASE_CONFLICT"
  );

  const staleVersionEvent = {
    schemaVersion: RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA,
    type: "BEGIN_SUBMIT",
    expectedVersion: flow.snapshot.version - 1,
    at: flow.time(flow.second + 1),
    ...flow.leaseProof()
  };
  assertLifecycleError(
    () => reduceRankProviderLifecycle(flow.snapshot, staleVersionEvent),
    "VERSION_CONFLICT"
  );

  flow.event(
    "RECOVER_EXPIRED_ACTION",
    { retryAt: flow.time(flow.second + 10) },
    6
  );
  assert.equal(flow.snapshot.state, "READY_TO_SUBMIT");
  flow.claim("connector-a");
  assert.equal(flow.snapshot.leaseGeneration, 2);
  assert.notEqual(flow.snapshot.leaseToken, leaseToken(1));
  assertLifecycleError(
    () =>
      flow.event("BEGIN_SUBMIT", {
        leaseOwner: "connector-a",
        leaseToken: leaseToken(1),
        leaseGeneration: 2
      }),
    "LEASE_CONFLICT"
  );
});

test("matches the database lease-owner character and length boundaries", () => {
  const withNode = new Flow();
  withNode.claim("worker@node");
  assert.equal(withNode.snapshot.leaseOwner, "worker@node");

  const atMaximumLength = `a${"@".repeat(99)}`;
  const maximum = new Flow();
  maximum.claim(atMaximumLength);
  assert.equal(maximum.snapshot.leaseOwner, atMaximumLength);

  for (const invalidOwner of [
    "@worker",
    `a${"b".repeat(100)}`,
    "worker/node"
  ]) {
    const invalid = new Flow();
    assertLifecycleError(
      () => invalid.claim(invalidOwner),
      "INVALID_EVENT"
    );
  }

  const invalidToken = new Flow();
  assertLifecycleError(
    () => invalidToken.claim("worker@node", 30, 1, "not-a-uuid"),
    "INVALID_EVENT"
  );
});

test("cancels only while absence of a provider submit is still proven", () => {
  const ready = new Flow();
  ready.event("CANCEL");
  assert.equal(ready.snapshot.state, "CANCELLED");

  const claimed = new Flow();
  claimed.claim();
  claimed.event("CANCEL");
  assert.equal(claimed.snapshot.state, "CANCELLED");

  const sent = new Flow();
  reachSubmitting(sent);
  assertLifecycleError(
    () => sent.event("CANCEL"),
    "ILLEGAL_TRANSITION"
  );

  const accepted = new Flow();
  reachSubmitted(accepted);
  assertLifecycleError(
    () => accepted.event("CANCEL"),
    "ILLEGAL_TRANSITION"
  );
});

test("rejects unknown and extra fields at every persisted boundary", () => {
  assertLifecycleError(
    () =>
      createRankProviderLifecycle({
        ...initialInput(),
        apiKey: "must-not-be-accepted"
      }),
    "INVALID_EVENT"
  );

  const initial = createRankProviderLifecycle(initialInput());
  assertLifecycleError(
    () =>
      rankProviderLifecycleSnapshot({
        ...initial,
        credentialId: "must-not-be-persisted"
      }),
    "INVALID_SNAPSHOT"
  );
  assertLifecycleError(
    () =>
      rankProviderLifecycleSnapshot({
        ...initial,
        capabilities: {
          ...initial.capabilities,
          undocumentedStatusVocabulary: true
        }
      }),
    "INVALID_SNAPSHOT"
  );
  assertLifecycleError(
    () =>
      rankProviderLifecycleEvent({
        schemaVersion: RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA,
        type: "CANCEL",
        expectedVersion: 1,
        at: time(1),
        authorization: "Bearer secret"
      }),
    "INVALID_EVENT"
  );
  assertLifecycleError(
    () =>
      rankProviderLifecycleEvent({
        schemaVersion: RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA,
        type: "FETCH_NORMALIZED",
        expectedVersion: 1,
        at: time(1),
        leaseOwner: "connector-a",
        leaseToken: leaseToken(1),
        leaseGeneration: 1,
        resultFacts: {
          ...normalizedFacts(1),
          rawResponse: { status: "invented" }
        }
      }),
    "INVALID_EVENT"
  );
  assertLifecycleError(
    () =>
      rankProviderLifecycleSnapshot({
        ...initial,
        schemaVersion: "rank-provider-lifecycle@2"
      }),
    "INVALID_SNAPSHOT"
  );
});

test("persists only redacted secret-free facts and keeps provider task identity immutable", () => {
  const secret = "super-secret-provider-token";
  const keyword = "private keyword text";
  const flow = new Flow({
    pollRepeatabilityConfirmed: true,
    fetchRepeatabilityConfirmed: true
  });
  reachStaged(flow);
  const taskId = flow.snapshot.providerTaskId;

  assertLifecycleError(
    () =>
      flow.event("CLAIM", {
        leaseOwner: "connector-z",
        leaseToken: leaseToken(99),
        leaseExpiresAt: flow.time(flow.second + 30),
        providerTaskId: "replacement-task"
      }),
    "INVALID_EVENT"
  );
  flow.claim("connector-z");
  flow.event("BEGIN_PERSIST", flow.leaseProof());
  flow.event("PERSISTED", flow.leaseProof());
  assert.equal(flow.snapshot.providerTaskId, taskId);

  const serialized = JSON.stringify(flow.snapshot);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(keyword), false);
  assert.equal(serialized.includes("credentialId"), false);
  assert.equal(serialized.includes("rawResponse"), false);
  assert.deepEqual(Object.keys(flow.snapshot.resultFacts ?? {}), [
    "schemaVersion",
    "normalizedPayloadSha256",
    "rowCount"
  ]);
});

test("rejects invalid response facts without inventing an Arsenkin schema", () => {
  const flow = new Flow();
  reachFetching(flow);
  assertLifecycleError(
    () =>
      flow.event("FETCH_NORMALIZED", {
        ...flow.leaseProof(),
        resultFacts: {
          schemaVersion: RANK_PROVIDER_RESULT_FACTS_SCHEMA,
          normalizedPayloadSha256: NORMALIZED_HASH,
          rowCount: 1,
          positions: [{ position: 1 }]
        }
      }),
    "INVALID_EVENT"
  );

  flow.event("FETCH_FAILED", {
    ...flow.leaseProof(),
    outcome: "INVALID_RESPONSE",
    retryAt: null
  });
  assert.equal(flow.snapshot.state, "FAILED_FINAL");
  assert.equal(flow.snapshot.failure?.code, "FETCH_INVALID_RESPONSE");
});

class Flow {
  snapshot: RankProviderLifecycleSnapshotV1;
  second = 0;
  readonly history: RankProviderLifecycleSnapshotV1[];

  constructor(
    capabilities?: {
      readonly pollRepeatabilityConfirmed: boolean;
      readonly fetchRepeatabilityConfirmed: boolean;
    },
    limits?: {
      readonly submit: number;
      readonly poll: number;
      readonly fetch: number;
      readonly persist: number;
    },
    readonly defaultLeaseSeconds = 30
  ) {
    this.snapshot = createRankProviderLifecycle(
      initialInput(capabilities, limits)
    );
    this.history = [this.snapshot];
  }

  event(
    type: RankProviderLifecycleEventType,
    extra: Readonly<Record<string, unknown>> = {},
    atSecond = this.second + 1
  ): RankProviderLifecycleSnapshotV1 {
    const previous = this.snapshot;
    const event = {
      schemaVersion: RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA,
      type,
      expectedVersion: previous.version,
      at: this.time(atSecond),
      ...extra
    };
    const parsedEvent = rankProviderLifecycleEvent(
      JSON.parse(JSON.stringify(event))
    );
    const next = reduceRankProviderLifecycle(
      JSON.parse(JSON.stringify(previous)),
      parsedEvent
    );
    assert.equal(next.version, previous.version + 1);
    assert.ok(next.leaseGeneration >= previous.leaseGeneration);
    for (const key of ["submit", "poll", "fetch", "persist"] as const) {
      assert.ok(next.attempts[key] >= previous.attempts[key]);
    }
    if (previous.providerTaskId !== null) {
      assert.equal(next.providerTaskId, previous.providerTaskId);
    }
    assert.deepEqual(
      rankProviderLifecycleSnapshot(JSON.parse(JSON.stringify(next))),
      next
    );
    this.snapshot = next;
    this.second = atSecond;
    this.history.push(next);
    return next;
  }

  claim(
    owner = "connector-a",
    leaseSeconds = this.defaultLeaseSeconds,
    atSecond = this.second + 1,
    token = leaseToken(this.snapshot.leaseGeneration + 1)
  ): RankProviderLifecycleSnapshotV1 {
    return this.event(
      "CLAIM",
      {
        leaseOwner: owner,
        leaseToken: token,
        leaseExpiresAt: this.time(atSecond + leaseSeconds)
      },
      atSecond
    );
  }

  leaseProof(): {
    readonly leaseOwner: string;
    readonly leaseToken: string;
    readonly leaseGeneration: number;
  } {
    assert.notEqual(this.snapshot.leaseOwner, null);
    assert.notEqual(this.snapshot.leaseToken, null);
    return {
      leaseOwner: this.snapshot.leaseOwner ?? "",
      leaseToken: this.snapshot.leaseToken ?? "",
      leaseGeneration: this.snapshot.leaseGeneration
    };
  }

  time(second: number): string {
    return time(second);
  }
}

function reachSubmitting(
  flow: Flow,
  leaseSeconds = flow.defaultLeaseSeconds
): void {
  flow.claim("connector-submit", leaseSeconds);
  flow.event("BEGIN_SUBMIT", flow.leaseProof());
}

function reachSubmitted(flow: Flow): void {
  reachSubmitting(flow);
  flow.event("SUBMIT_ACCEPTED", {
    ...flow.leaseProof(),
    providerTaskId: "provider-task-001"
  });
}

function reachPolling(flow: Flow): void {
  reachSubmitted(flow);
  flow.event("SCHEDULE_POLL", {
    nextActionAt: flow.time(flow.second + 1)
  });
  flow.claim("connector-poll");
  flow.event("BEGIN_POLL", flow.leaseProof());
}

function reachFetching(flow: Flow): void {
  reachPolling(flow);
  flow.event("POLL_RESULT_READY", flow.leaseProof());
  flow.claim("connector-fetch");
  flow.event("BEGIN_FETCH", flow.leaseProof());
}

function reachStaged(flow: Flow): void {
  reachFetching(flow);
  flow.event("FETCH_NORMALIZED", {
    ...flow.leaseProof(),
    resultFacts: normalizedFacts(250)
  });
  flow.event("STAGE_RESULT", flow.leaseProof());
}

function initialInput(
  capabilities?: {
    readonly pollRepeatabilityConfirmed: boolean;
    readonly fetchRepeatabilityConfirmed: boolean;
  },
  limits = { submit: 3, poll: 5, fetch: 3, persist: 3 }
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: RANK_PROVIDER_LIFECYCLE_INIT_SCHEMA,
    at: time(0),
    limits,
    ...(capabilities
      ? {
          capabilities: {
            schemaVersion: RANK_PROVIDER_CONTRACT_CAPABILITIES_SCHEMA,
            ...capabilities
          }
        }
      : {})
  };
}

function normalizedFacts(rowCount: number): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: RANK_PROVIDER_RESULT_FACTS_SCHEMA,
    normalizedPayloadSha256: NORMALIZED_HASH,
    rowCount
  };
}

function time(second: number): string {
  return new Date(BASE_TIME + second * 1_000).toISOString();
}

function leaseToken(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence
    .toString(16)
    .padStart(12, "0")}`;
}

function assertLifecycleError(
  action: () => unknown,
  code: RankProviderLifecycleErrorCode
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof RankProviderLifecycleError);
    assert.equal(error.code, code);
    return true;
  });
}

test("exports only the current versioned schemas", () => {
  assert.equal(RANK_PROVIDER_LIFECYCLE_SCHEMA, "rank-provider-lifecycle@1");
  assert.equal(
    RANK_PROVIDER_LIFECYCLE_EVENT_SCHEMA,
    "rank-provider-lifecycle-event@1"
  );
});
