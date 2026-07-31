import assert from "node:assert/strict";
import test from "node:test";
import { loadProvisionerConfiguration } from "../nats/provisioner-config.mjs";
import {
  NatsTopologyError,
  buildNatsTopology,
  provisionNatsTopology,
  safeProvisionerFailure
} from "../nats/topology.mjs";

const environment = "prod-eu1";

test("topology is exact, bounded and compatible with app-level retry/DLQ", () => {
  const topology = buildNatsTopology(environment);

  assert.equal(
    topology.sourceSubject,
    "prod-eu1.identity.session-family.revoked.v1"
  );
  assert.equal(
    topology.dlqSubject,
    "prod-eu1.dlq.realtime.identity.session-family.revoked.v1"
  );
  assert.deepEqual(topology.sourceStream.subjects, [topology.sourceSubject]);
  assert.deepEqual(topology.authEmailSubjects, [
    "prod-eu1.email.identity.email-verification.requested.v1",
    "prod-eu1.email.identity.password-reset.requested.v1",
    "prod-eu1.email.workspace.invite.requested.v1",
    "prod-eu1.email.billing.npd-receipt.delivery-requested.v1"
  ]);
  assert.equal(topology.authEmailFilterSubject, "prod-eu1.email.>");
  assert.equal(
    topology.authEmailDlqSubject,
    "prod-eu1.dlq.jobs.transactional-email.v1"
  );
  assert.deepEqual(
    topology.authEmailStream.subjects,
    topology.authEmailSubjects
  );
  assert.deepEqual(topology.dlqStream.subjects, [
    topology.dlqSubject,
    topology.authEmailDlqSubject
  ]);

  for (const stream of [
    topology.sourceStream,
    topology.authEmailStream,
    topology.dlqStream
  ]) {
    assert.equal(stream.storage, "file");
    assert.equal(stream.retention, "limits");
    assert.equal(stream.discard, "new");
    assert.equal(stream.max_msg_size, 65_536);
    assert.ok(stream.max_age > 0);
    assert.ok(stream.max_bytes > 0);
    assert.ok(stream.max_msgs > 0);
    assert.equal(stream.num_replicas, 1);
    assert.equal(stream.deny_delete, true);
    assert.equal(stream.deny_purge, true);
    assert.equal(stream.allow_direct, false);
  }

  assert.equal(topology.sourceStream.max_consumers, 4);
  assert.equal(
    topology.consumer.durable_name,
    "realtime_session_family_revoked_v1"
  );
  assert.equal(topology.consumer.deliver_policy, "all");
  assert.equal(topology.consumer.replay_policy, "instant");
  assert.equal(topology.consumer.ack_policy, "explicit");
  assert.equal(topology.consumer.ack_wait, 60_000_000_000);
  assert.equal(topology.consumer.filter_subject, topology.sourceSubject);
  assert.equal(topology.consumer.max_ack_pending, 1);
  assert.equal(topology.consumer.max_deliver, -1);
  assert.equal(topology.consumer.num_replicas, 1);
  assert.equal(topology.consumer.mem_storage, false);
  assert.equal("deliver_subject" in topology.consumer, false);
  assert.equal("backoff" in topology.consumer, false);
  assert.equal(topology.authEmailStream.name, "AUTH_EMAIL_EVENTS");
  assert.equal(topology.authEmailStream.max_consumers, 2);
  assert.equal(topology.authEmailConsumer.durable_name, "jobs_auth_email_v1");
  assert.equal(
    topology.authEmailConsumer.filter_subject,
    topology.authEmailFilterSubject
  );
  assert.equal(topology.authEmailConsumer.max_ack_pending, 16);
  assert.equal(topology.authEmailConsumer.max_deliver, -1);
  assert.equal("deliver_subject" in topology.authEmailConsumer, false);
});

test("provisioner creates exact resources then becomes idempotent", async () => {
  const manager = fakeManager();

  assert.deepEqual(
    await provisionNatsTopology({ manager, environment }),
    {
      sourceStream: "created",
      authEmailStream: "created",
      dlqStream: "created",
      consumer: "created",
      authEmailConsumer: "created"
    }
  );
  assert.deepEqual(manager.calls, [
    "stream.info:IDENTITY_EVENTS",
    "stream.add:IDENTITY_EVENTS",
    "stream.info:AUTH_EMAIL_EVENTS",
    "stream.add:AUTH_EMAIL_EVENTS",
    "stream.info:DOMAIN_EVENTS_DLQ",
    "stream.add:DOMAIN_EVENTS_DLQ",
    "consumer.info:IDENTITY_EVENTS:realtime_session_family_revoked_v1",
    "consumer.add:IDENTITY_EVENTS:realtime_session_family_revoked_v1",
    "consumer.info:AUTH_EMAIL_EVENTS:jobs_auth_email_v1",
    "consumer.add:AUTH_EMAIL_EVENTS:jobs_auth_email_v1"
  ]);

  manager.calls.length = 0;
  assert.deepEqual(
    await provisionNatsTopology({ manager, environment }),
    {
      sourceStream: "unchanged",
      authEmailStream: "unchanged",
      dlqStream: "unchanged",
      consumer: "unchanged",
      authEmailConsumer: "unchanged"
    }
  );
  assert.deepEqual(manager.calls, [
    "stream.info:IDENTITY_EVENTS",
    "stream.info:AUTH_EMAIL_EVENTS",
    "stream.info:DOMAIN_EVENTS_DLQ",
    "consumer.info:IDENTITY_EVENTS:realtime_session_family_revoked_v1",
    "consumer.info:AUTH_EMAIL_EVENTS:jobs_auth_email_v1"
  ]);
});

test("server-omitted false stream defaults remain idempotent", async () => {
  const manager = fakeManager();
  await provisionNatsTopology({ manager, environment });

  for (const streamName of [
    "IDENTITY_EVENTS",
    "AUTH_EMAIL_EVENTS",
    "DOMAIN_EVENTS_DLQ"
  ]) {
    const config = manager.streamRecords.get(streamName);
    delete config.no_ack;
    delete config.allow_rollup_hdrs;
    delete config.allow_direct;
    delete config.discard_new_per_subject;
  }
  manager.calls.length = 0;

  assert.deepEqual(
    await provisionNatsTopology({ manager, environment }),
    {
      sourceStream: "unchanged",
      authEmailStream: "unchanged",
      dlqStream: "unchanged",
      consumer: "unchanged",
      authEmailConsumer: "unchanged"
    }
  );
  assert.equal(
    manager.calls.some((call) => call.startsWith("stream.update:")),
    false
  );
});

test("provisioner reconciles only allowlisted mutable drift", async () => {
  const manager = fakeManager();
  await provisionNatsTopology({ manager, environment });

  manager.streamRecords.get("IDENTITY_EVENTS").max_age = 1;
  manager.streamRecords.get("DOMAIN_EVENTS_DLQ").max_bytes = 1;
  manager.consumerRecords
    .get("IDENTITY_EVENTS:realtime_session_family_revoked_v1")
    .config.max_ack_pending = 8;
  manager.calls.length = 0;

  assert.deepEqual(
    await provisionNatsTopology({ manager, environment }),
    {
      sourceStream: "updated",
      authEmailStream: "unchanged",
      dlqStream: "updated",
      consumer: "updated",
      authEmailConsumer: "unchanged"
    }
  );
  assert.deepEqual(manager.calls, [
    "stream.info:IDENTITY_EVENTS",
    "stream.update:IDENTITY_EVENTS",
    "stream.info:AUTH_EMAIL_EVENTS",
    "stream.info:DOMAIN_EVENTS_DLQ",
    "stream.update:DOMAIN_EVENTS_DLQ",
    "consumer.info:IDENTITY_EVENTS:realtime_session_family_revoked_v1",
    "consumer.update:IDENTITY_EVENTS:realtime_session_family_revoked_v1",
    "consumer.info:AUTH_EMAIL_EVENTS:jobs_auth_email_v1"
  ]);
});

test("provisioner permits only the known additive DLQ subject migration", async () => {
  const manager = fakeManager();
  await provisionNatsTopology({ manager, environment });
  manager.streamRecords.get("DOMAIN_EVENTS_DLQ").subjects = [
    "prod-eu1.dlq.realtime.identity.session-family.revoked.v1"
  ];
  manager.calls.length = 0;

  const result = await provisionNatsTopology({ manager, environment });
  assert.equal(result.dlqStream, "updated");
  assert.deepEqual(
    manager.streamRecords.get("DOMAIN_EVENTS_DLQ").subjects,
    buildNatsTopology(environment).dlqStream.subjects
  );
});

test("provisioner fails closed on unsafe stream identity or transform drift", async () => {
  const cases = [
    ["subjects", (config) => (config.subjects = ["prod-eu1.identity.>"])],
    ["storage", (config) => (config.storage = "memory")],
    ["sealed", (config) => (config.sealed = true)],
    [
      "republish",
      (config) =>
        (config.republish = { src: ">", dest: "exfiltrated.>" })
    ],
    [
      "subject_transform",
      (config) =>
        (config.subject_transform = { src: ">", dest: "retargeted.>" })
    ]
  ];

  for (const [name, mutate] of cases) {
    const manager = fakeManager();
    await provisionNatsTopology({ manager, environment });
    mutate(manager.streamRecords.get("IDENTITY_EVENTS"));
    manager.calls.length = 0;

    await assert.rejects(
      provisionNatsTopology({ manager, environment }),
      (error) =>
        error instanceof NatsTopologyError &&
        error.code === "UNSAFE_STREAM_DRIFT" &&
        error.resource === "IDENTITY_EVENTS",
      name
    );
    assert.equal(
      manager.calls.some((call) => call.startsWith("stream.update:")),
      false,
      `${name} must not be reconciled automatically`
    );
  }
});

test("provisioner fails closed on unsafe consumer delivery drift", async () => {
  const cases = [
    ["filter", (record) => (record.config.filter_subject = "prod-eu1.identity.>")],
    ["push", (record) => (record.config.deliver_subject = "unsafe.push")],
    ["headers", (record) => (record.config.headers_only = true)],
    ["backoff", (record) => (record.config.backoff = [1_000_000])],
    ["paused", (record) => (record.paused = true)]
  ];

  for (const [name, mutate] of cases) {
    const manager = fakeManager();
    await provisionNatsTopology({ manager, environment });
    mutate(
      manager.consumerRecords.get(
        "IDENTITY_EVENTS:realtime_session_family_revoked_v1"
      )
    );
    manager.calls.length = 0;

    await assert.rejects(
      provisionNatsTopology({ manager, environment }),
      (error) =>
        error instanceof NatsTopologyError &&
        error.code === "UNSAFE_CONSUMER_DRIFT",
      name
    );
    assert.equal(
      manager.calls.some((call) => call.startsWith("consumer.update:")),
      false,
      `${name} must not be reconciled automatically`
    );
  }
});

test("partial failure remains retryable and never exposes the underlying error", async () => {
  const secret = "secret-provider-error-material";
  const manager = fakeManager({
    failStreamAdd: "DOMAIN_EVENTS_DLQ",
    failureMessage: secret
  });

  let failure;
  try {
    await provisionNatsTopology({ manager, environment });
  } catch (error) {
    failure = error;
  }

  assert.ok(failure instanceof NatsTopologyError);
  assert.equal(failure.code, "STREAM_CREATE_FAILED");
  assert.equal(manager.streamRecords.has("IDENTITY_EVENTS"), true);
  assert.equal(manager.streamRecords.has("AUTH_EMAIL_EVENTS"), true);
  assert.equal(manager.streamRecords.has("DOMAIN_EVENTS_DLQ"), false);
  assert.equal(manager.consumerRecords.size, 0);
  const output = safeProvisionerFailure(failure);
  assert.match(output, /STREAM_CREATE_FAILED \(DOMAIN_EVENTS_DLQ\)/u);
  assert.equal(output.includes(secret), false);
  assert.equal(safeProvisionerFailure(new Error(secret)).includes(secret), false);
});

test("provisioner config rejects credentials in URL, whitespace and placeholders", () => {
  const valid = {
    NATS_URL: "nats://nats:4222",
    NATS_USER: "topology_provisioner",
    NATS_PASSWORD: "generated-provisioner-password-1234567890",
    NATS_EVENT_ENVIRONMENT: environment
  };
  assert.deepEqual(loadProvisionerConfiguration(valid), {
    url: valid.NATS_URL,
    user: valid.NATS_USER,
    password: valid.NATS_PASSWORD,
    environment
  });

  const cases = [
    ["NATS_URL", "nats://user:password@nats:4222"],
    ["NATS_USER", " topology_provisioner"],
    ["NATS_USER", "replace-with-user"],
    ["NATS_PASSWORD", "replace-with-a-password-value-123456789"],
    ["NATS_PASSWORD", "generated password value xxxxxxxxxxxxxxxxx"],
    ["NATS_EVENT_ENVIRONMENT", "Prod"]
  ];
  for (const [name, value] of cases) {
    assert.throws(
      () => loadProvisionerConfiguration({ ...valid, [name]: value }),
      (error) =>
        error instanceof NatsTopologyError &&
        (error.code === "INVALID_CONFIGURATION" ||
          error.code === "INVALID_EVENT_ENVIRONMENT")
    );
  }
});

function fakeManager(options = {}) {
  const calls = [];
  const streamRecords = new Map();
  const consumerRecords = new Map();

  return {
    calls,
    streamRecords,
    consumerRecords,
    streams: {
      async info(name) {
        calls.push(`stream.info:${name}`);
        const config = streamRecords.get(name);
        if (!config) throw notFound();
        return { config: structuredClone(config) };
      },
      async add(config) {
        calls.push(`stream.add:${config.name}`);
        if (options.failStreamAdd === config.name) {
          throw new Error(options.failureMessage);
        }
        streamRecords.set(config.name, structuredClone(config));
        return { config: structuredClone(config) };
      },
      async update(name, delta) {
        calls.push(`stream.update:${name}`);
        const config = {
          ...streamRecords.get(name),
          ...structuredClone(delta)
        };
        streamRecords.set(name, config);
        return { config: structuredClone(config) };
      }
    },
    consumers: {
      async info(stream, name) {
        calls.push(`consumer.info:${stream}:${name}`);
        const record = consumerRecords.get(`${stream}:${name}`);
        if (!record) throw notFound();
        return structuredClone(record);
      },
      async add(stream, config) {
        calls.push(`consumer.add:${stream}:${config.durable_name}`);
        const record = {
          config: structuredClone(config),
          paused: false
        };
        consumerRecords.set(`${stream}:${config.durable_name}`, record);
        return structuredClone(record);
      },
      async update(stream, name, delta) {
        calls.push(`consumer.update:${stream}:${name}`);
        const record = consumerRecords.get(`${stream}:${name}`);
        record.config = { ...record.config, ...structuredClone(delta) };
        return structuredClone(record);
      }
    }
  };
}

function notFound() {
  return Object.assign(new Error("not found"), { code: 404 });
}
