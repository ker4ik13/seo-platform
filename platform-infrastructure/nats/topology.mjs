const IDENTITY_EVENT_SUFFIX = "identity.session-family.revoked.v1";
const IDENTITY_DLQ_SUFFIX =
  "dlq.realtime.identity.session-family.revoked.v1";
const AUTH_EMAIL_EVENT_SUFFIXES = Object.freeze([
  "identity.email-verification.requested.v1",
  "identity.password-reset.requested.v1",
  "workspace.invite.requested.v1"
]);
const AUTH_EMAIL_FILTER_SUFFIX = "email.>";
const AUTH_EMAIL_DLQ_SUFFIX = "dlq.jobs.transactional-email.v1";

const SOURCE_STREAM_NAME = "IDENTITY_EVENTS";
const AUTH_EMAIL_STREAM_NAME = "AUTH_EMAIL_EVENTS";
const DLQ_STREAM_NAME = "DOMAIN_EVENTS_DLQ";
const CONSUMER_NAME = "realtime_session_family_revoked_v1";
const AUTH_EMAIL_CONSUMER_NAME = "jobs_auth_email_v1";

const MAX_MESSAGE_SIZE_BYTES = 64 * 1024;
const SOURCE_MAX_AGE_NANOS = 30 * 24 * 60 * 60 * 1_000_000_000;
const DLQ_MAX_AGE_NANOS = 60 * 24 * 60 * 60 * 1_000_000_000;
const DUPLICATE_WINDOW_NANOS = 2 * 60 * 60 * 1_000_000_000;
const CONSUMER_ACK_WAIT_NANOS = 60 * 1_000_000_000;

const environmentPattern =
  /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;

const safeStreamUpdateFields = Object.freeze([
  "description",
  "subjects",
  "max_consumers",
  "max_msgs",
  "max_bytes",
  "max_age",
  "max_msgs_per_subject",
  "max_msg_size",
  "discard",
  "duplicate_window",
  "no_ack",
  "deny_delete",
  "deny_purge",
  "allow_rollup_hdrs",
  "allow_direct",
  "discard_new_per_subject"
]);

const safeConsumerUpdateFields = Object.freeze([
  "description",
  "ack_wait",
  "max_deliver",
  "max_ack_pending",
  "max_waiting"
]);

const omittedFalseStreamFields = new Set([
  "no_ack",
  "allow_rollup_hdrs",
  "allow_direct",
  "discard_new_per_subject"
]);

export class NatsTopologyError extends Error {
  constructor(code, resource) {
    super(`${code}:${resource}`);
    this.name = "NatsTopologyError";
    this.code = code;
    this.resource = resource;
  }
}

export function buildNatsTopology(environment) {
  if (
    typeof environment !== "string" ||
    !environmentPattern.test(environment)
  ) {
    throw new NatsTopologyError(
      "INVALID_EVENT_ENVIRONMENT",
      "NATS_EVENT_ENVIRONMENT"
    );
  }

  const sourceSubject = `${environment}.${IDENTITY_EVENT_SUFFIX}`;
  const dlqSubject = `${environment}.${IDENTITY_DLQ_SUFFIX}`;
  const authEmailSubjects = Object.freeze(
    AUTH_EMAIL_EVENT_SUFFIXES.map((suffix) => `${environment}.email.${suffix}`)
  );
  const authEmailFilterSubject = `${environment}.${AUTH_EMAIL_FILTER_SUFFIX}`;
  const authEmailDlqSubject = `${environment}.${AUTH_EMAIL_DLQ_SUFFIX}`;

  const sourceStream = Object.freeze({
    name: SOURCE_STREAM_NAME,
    description: "Terminal identity session-family events",
    subjects: Object.freeze([sourceSubject]),
    retention: "limits",
    storage: "file",
    discard: "new",
    max_consumers: 4,
    max_msgs: 1_000_000,
    max_bytes: 512 * 1024 * 1024,
    max_age: SOURCE_MAX_AGE_NANOS,
    max_msgs_per_subject: 1_000_000,
    max_msg_size: MAX_MESSAGE_SIZE_BYTES,
    duplicate_window: DUPLICATE_WINDOW_NANOS,
    num_replicas: 1,
    no_ack: false,
    deny_delete: true,
    deny_purge: true,
    allow_rollup_hdrs: false,
    allow_direct: false,
    discard_new_per_subject: false
  });

  const dlqStream = Object.freeze({
    name: DLQ_STREAM_NAME,
    description: "Terminal domain-event dead letters",
    subjects: Object.freeze([dlqSubject, authEmailDlqSubject]),
    retention: "limits",
    storage: "file",
    discard: "new",
    max_consumers: 4,
    max_msgs: 100_000,
    max_bytes: 512 * 1024 * 1024,
    max_age: DLQ_MAX_AGE_NANOS,
    max_msgs_per_subject: 100_000,
    max_msg_size: MAX_MESSAGE_SIZE_BYTES,
    duplicate_window: DUPLICATE_WINDOW_NANOS,
    num_replicas: 1,
    no_ack: false,
    deny_delete: true,
    deny_purge: true,
    allow_rollup_hdrs: false,
    allow_direct: false,
    discard_new_per_subject: false
  });

  const consumer = Object.freeze({
    durable_name: CONSUMER_NAME,
    name: CONSUMER_NAME,
    description: "Realtime terminal session-family revocation consumer",
    deliver_policy: "all",
    ack_policy: "explicit",
    ack_wait: CONSUMER_ACK_WAIT_NANOS,
    max_deliver: -1,
    filter_subject: sourceSubject,
    replay_policy: "instant",
    max_ack_pending: 1,
    max_waiting: 32,
    num_replicas: 1,
    mem_storage: false
  });

  const authEmailStream = Object.freeze({
    name: AUTH_EMAIL_STREAM_NAME,
    description: "Secret-free transactional authentication email intents",
    subjects: authEmailSubjects,
    retention: "limits",
    storage: "file",
    discard: "new",
    max_consumers: 2,
    max_msgs: 1_000_000,
    max_bytes: 512 * 1024 * 1024,
    max_age: SOURCE_MAX_AGE_NANOS,
    max_msgs_per_subject: 500_000,
    max_msg_size: MAX_MESSAGE_SIZE_BYTES,
    duplicate_window: DUPLICATE_WINDOW_NANOS,
    num_replicas: 1,
    no_ack: false,
    deny_delete: true,
    deny_purge: true,
    allow_rollup_hdrs: false,
    allow_direct: false,
    discard_new_per_subject: false
  });

  const authEmailConsumer = Object.freeze({
    durable_name: AUTH_EMAIL_CONSUMER_NAME,
    name: AUTH_EMAIL_CONSUMER_NAME,
    description: "Jobs transactional authentication email consumer",
    deliver_policy: "all",
    ack_policy: "explicit",
    ack_wait: CONSUMER_ACK_WAIT_NANOS,
    max_deliver: -1,
    filter_subject: authEmailFilterSubject,
    replay_policy: "instant",
    max_ack_pending: 16,
    max_waiting: 32,
    num_replicas: 1,
    mem_storage: false
  });

  return Object.freeze({
    sourceSubject,
    dlqSubject,
    authEmailSubjects,
    authEmailFilterSubject,
    authEmailDlqSubject,
    sourceStream,
    authEmailStream,
    dlqStream,
    consumer,
    authEmailConsumer
  });
}

export async function provisionNatsTopology({
  manager,
  environment
}) {
  if (!manager?.streams || !manager?.consumers) {
    throw new NatsTopologyError(
      "INVALID_MANAGER",
      "jetstream-manager"
    );
  }

  const topology = buildNatsTopology(environment);
  const sourceStream = await ensureStream(
    manager.streams,
    topology.sourceStream
  );
  const authEmailStream = await ensureStream(
    manager.streams,
    topology.authEmailStream
  );
  const dlqStream = await ensureStream(
    manager.streams,
    topology.dlqStream
  );
  const consumer = await ensureConsumer(
    manager.consumers,
    topology.sourceStream.name,
    topology.consumer
  );
  const authEmailConsumer = await ensureConsumer(
    manager.consumers,
    topology.authEmailStream.name,
    topology.authEmailConsumer
  );

  return Object.freeze({
    sourceStream,
    authEmailStream,
    dlqStream,
    consumer,
    authEmailConsumer
  });
}

export function safeProvisionerFailure(error) {
  if (error instanceof NatsTopologyError) {
    return `nats-topology-provisioner: ${error.code} (${error.resource})`;
  }
  return "nats-topology-provisioner: UNEXPECTED_FAILURE (topology)";
}

async function ensureStream(streams, desired) {
  let current;
  try {
    current = await streams.info(desired.name);
  } catch (error) {
    if (!isNotFound(error)) {
      throw operationFailure("STREAM_INFO_FAILED", desired.name);
    }
  }

  if (!current) {
    try {
      await streams.add(cloneConfig(desired));
      return "created";
    } catch {
      throw operationFailure("STREAM_CREATE_FAILED", desired.name);
    }
  }

  assertSafeStreamIdentity(current.config, desired);
  const delta = changedFields(
    current.config,
    desired,
    safeStreamUpdateFields
  );
  if (Object.keys(delta).length === 0) return "unchanged";

  try {
    await streams.update(desired.name, delta);
    return "updated";
  } catch {
    throw operationFailure("STREAM_UPDATE_FAILED", desired.name);
  }
}

async function ensureConsumer(consumers, streamName, desired) {
  let current;
  try {
    current = await consumers.info(streamName, desired.durable_name);
  } catch (error) {
    if (!isNotFound(error)) {
      throw operationFailure(
        "CONSUMER_INFO_FAILED",
        desired.durable_name
      );
    }
  }

  if (!current) {
    try {
      await consumers.add(streamName, cloneConfig(desired));
      return "created";
    } catch {
      throw operationFailure(
        "CONSUMER_CREATE_FAILED",
        desired.durable_name
      );
    }
  }

  assertSafeConsumerIdentity(current, desired);
  const delta = changedFields(
    current.config,
    desired,
    safeConsumerUpdateFields
  );
  if (Object.keys(delta).length === 0) return "unchanged";

  try {
    await consumers.update(streamName, desired.durable_name, delta);
    return "updated";
  } catch {
    throw operationFailure(
      "CONSUMER_UPDATE_FAILED",
      desired.durable_name
    );
  }
}

function assertSafeStreamIdentity(current, desired) {
  const subjectsAreSafe =
    sameStringArray(current?.subjects, desired.subjects) ||
    (desired.name === DLQ_STREAM_NAME &&
      sameStringArray(current?.subjects, [desired.subjects[0]]));
  const unsafe =
    current?.name !== desired.name ||
    current?.storage !== desired.storage ||
    current?.retention !== desired.retention ||
    current?.num_replicas !== desired.num_replicas ||
    current?.sealed === true ||
    !subjectsAreSafe ||
    current?.republish !== undefined ||
    current?.subject_transform !== undefined ||
    current?.mirror !== undefined ||
    (Array.isArray(current?.sources) && current.sources.length > 0);

  if (unsafe) {
    throw operationFailure("UNSAFE_STREAM_DRIFT", desired.name);
  }
}

function assertSafeConsumerIdentity(info, desired) {
  const current = info?.config;
  const currentName = current?.name ?? current?.durable_name;
  const unsafe =
    currentName !== desired.name ||
    current?.durable_name !== desired.durable_name ||
    current?.filter_subject !== desired.filter_subject ||
    (Array.isArray(current?.filter_subjects) &&
      current.filter_subjects.length > 0) ||
    current?.deliver_subject !== undefined ||
    current?.deliver_group !== undefined ||
    current?.flow_control === true ||
    current?.idle_heartbeat !== undefined ||
    current?.headers_only === true ||
    (Array.isArray(current?.backoff) && current.backoff.length > 0) ||
    current?.pause_until !== undefined ||
    info?.paused === true ||
    current?.opt_start_seq !== undefined ||
    current?.opt_start_time !== undefined ||
    current?.rate_limit_bps !== undefined ||
    current?.ack_policy !== desired.ack_policy ||
    current?.deliver_policy !== desired.deliver_policy ||
    current?.replay_policy !== desired.replay_policy ||
    current?.num_replicas !== desired.num_replicas ||
    Boolean(current?.mem_storage) !== desired.mem_storage;

  if (unsafe) {
    throw operationFailure(
      "UNSAFE_CONSUMER_DRIFT",
      desired.durable_name
    );
  }
}

function changedFields(current, desired, fields) {
  const delta = {};
  for (const field of fields) {
    if (!sameFieldValue(field, current?.[field], desired[field])) {
      delta[field] = desired[field];
    }
  }
  return delta;
}

function sameFieldValue(field, left, right) {
  if (
    omittedFalseStreamFields.has(field) &&
    left === undefined &&
    right === false
  ) {
    return true;
  }
  return sameValue(left, right);
}

function sameValue(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return sameStringArray(left, right);
  }
  return left === right;
}

function sameStringArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function cloneConfig(config) {
  return {
    ...config,
    ...(Array.isArray(config.subjects)
      ? { subjects: [...config.subjects] }
      : {})
  };
}

function isNotFound(error) {
  if (typeof error !== "object" || error === null) return false;
  const candidates = [
    error.code,
    error.status,
    error.api_error?.code,
    error.apiError?.code
  ];
  return candidates.some(
    (candidate) => candidate === 404 || candidate === "404"
  );
}

function operationFailure(code, resource) {
  return new NatsTopologyError(code, resource);
}
