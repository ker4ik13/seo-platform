import assert from "node:assert/strict";
import test from "node:test";
import type { NatsConnection } from "@nats-io/transport-node";
import {
  AckPolicy,
  DeliverPolicy,
  DiscardPolicy,
  RetentionPolicy,
  ReplayPolicy,
  StorageType,
  type Consumer,
  type ConsumerInfo,
  type ConsumerMessages,
  type JetStreamClient,
  type JetStreamManager,
  type JetStreamPublishOptions
} from "@nats-io/jetstream";
import type { AppConfig } from "../config/app-config.js";
import { NatsService } from "./nats.service.js";

test("readiness proves exact source, durable pull consumer and DLQ topology", async () => {
  const streamRequests: string[] = [];
  const consumerRequests: string[][] = [];
  const service = serviceFixture();
  setManager(service, managerFixture({
    streamRequests,
    consumerRequests
  }));

  await service.assertEventConsumerTopology();

  assert.deepEqual(streamRequests.sort(), [
    "DOMAIN_EVENTS_DLQ",
    "IDENTITY_EVENTS"
  ]);
  assert.deepEqual(consumerRequests, [
    ["IDENTITY_EVENTS", "realtime_session_family_revoked_v1"]
  ]);
});

test("readiness rejects wildcard or additional source and DLQ subjects", async () => {
  for (const subjects of [
    ["prod.identity.>"],
    [
      "prod.identity.session-family.revoked.v1",
      "prod.identity.another-event.v1"
    ]
  ]) {
    const service = serviceFixture();
    setManager(service, managerFixture({ sourceSubjects: subjects }));
    await assert.rejects(
      service.assertEventConsumerTopology(),
      /source stream topology mismatch/u
    );
  }

  for (const subjects of [
    ["prod.dlq.>"],
    [
      "prod.dlq.realtime.identity.session-family.revoked.v1",
      "prod.dlq.realtime.identity.another-event.v1"
    ]
  ]) {
    const service = serviceFixture();
    setManager(service, managerFixture({ deadLetterSubjects: subjects }));
    await assert.rejects(
      service.assertEventConsumerTopology(),
      /dead-letter stream topology mismatch/u
    );
  }
});

test("readiness rejects unsafe source and DLQ stream structural drift", async () => {
  const drifts: ReadonlyArray<Readonly<Record<string, unknown>>> = [
    { storage: StorageType.Memory },
    { retention: RetentionPolicy.Interest },
    { discard: DiscardPolicy.Old },
    { max_consumers: 1 },
    { max_msgs: 1 },
    { max_bytes: 1 },
    { max_age: 1 },
    { max_msgs_per_subject: 1 },
    { num_replicas: 3 },
    { no_ack: true },
    { deny_delete: false },
    { deny_purge: false },
    { allow_direct: true },
    { allow_rollup_hdrs: true },
    { discard_new_per_subject: true },
    { sealed: true },
    { max_msg_size: -1 },
    { duplicate_window: 1 },
    { republish: { src: ">", dest: "exfiltrated.>" } },
    { subject_transform: { src: ">", dest: "retargeted.>" } },
    { mirror: { name: "UNTRUSTED" } },
    { sources: [{ name: "UNTRUSTED" }] }
  ];

  for (const drift of drifts) {
    const sourceService = serviceFixture();
    setManager(sourceService, managerFixture({ sourceConfig: drift }));
    await assert.rejects(
      sourceService.assertEventConsumerTopology(),
      /source stream topology mismatch/u
    );

    const deadLetterService = serviceFixture();
    setManager(
      deadLetterService,
      managerFixture({ deadLetterConfig: drift })
    );
    await assert.rejects(
      deadLetterService.assertEventConsumerTopology(),
      /dead-letter stream topology mismatch/u
    );
  }
});

test("readiness accepts wire-omitted safe false defaults", async () => {
  const omittedStreamDefaults = {
    no_ack: undefined,
    allow_direct: undefined,
    allow_rollup_hdrs: undefined
  };
  const service = serviceFixture();
  setManager(
    service,
    managerFixture({
      sourceConfig: omittedStreamDefaults,
      deadLetterConfig: omittedStreamDefaults,
      consumer: consumerFixture({}, { mem_storage: undefined })
    })
  );

  await service.assertEventConsumerTopology();
});

test("readiness rejects unsafe durable consumer drift", async () => {
  const drifts: ReadonlyArray<{
    readonly info?: Partial<ConsumerInfo>;
    readonly config?: Readonly<Record<string, unknown>>;
  }> = [
    { info: { paused: true } },
    { config: { backoff: [1_000_000_000] } },
    { config: { deliver_policy: DeliverPolicy.Last } },
    { config: { replay_policy: ReplayPolicy.Original } },
    { config: { ack_wait: 30_000_000_000 } },
    { config: { max_ack_pending: 2 } },
    { config: { max_waiting: 0 } },
    { config: { max_expires: 1 } },
    { config: { inactive_threshold: 1 } },
    { config: { max_deliver: 8 } },
    { config: { filter_subject: "prod.identity.>" } },
    { config: { deliver_subject: "push.subject" } },
    { config: { deliver_group: "push-group" } },
    { config: { flow_control: true } },
    { config: { idle_heartbeat: 1_000_000_000 } },
    { config: { pause_until: "2026-07-30T12:00:00.000Z" } },
    { config: { opt_start_seq: 1 } },
    { config: { rate_limit_bps: 1 } },
    { config: { num_replicas: 0 } },
    { config: { mem_storage: true } }
  ];

  for (const drift of drifts) {
    const service = serviceFixture();
    setManager(
      service,
      managerFixture({
        consumer: consumerFixture(drift.info, drift.config)
      })
    );
    await assert.rejects(
      service.assertEventConsumerTopology(),
      /durable consumer topology mismatch/u
    );
  }
});

test("fetch requests exactly one bounded pull message", async () => {
  const options: unknown[] = [];
  const messages = {} as ConsumerMessages;
  const service = serviceFixture();
  setConsumer(service, {
    fetch: async (input) => {
      options.push(input);
      return messages;
    }
  });

  assert.equal(await service.fetchEventMessages(), messages);
  assert.deepEqual(options, [{ max_messages: 1, expires: 1_000 }]);
});

test("DLQ publish uses deterministic msgID, bounded timeout and expected stream", async () => {
  const calls: Array<{
    readonly subject: string;
    readonly payload: string | Uint8Array | undefined;
    readonly options: Partial<JetStreamPublishOptions> | undefined;
  }> = [];
  const service = serviceFixture();
  setJetStream(service, {
    publish: async (subject, payload, options) => {
      calls.push({ subject, payload, options });
      return { stream: "DOMAIN_EVENTS_DLQ", seq: 12, duplicate: false };
    }
  });

  await service.publishDeadLetter('{"schemaVersion":1}', "failure-id");

  assert.deepEqual(calls, [{
    subject: "prod.dlq.realtime.identity.session-family.revoked.v1",
    payload: '{"schemaVersion":1}',
    options: {
      msgID: "failure-id",
      timeout: 5_000,
      expect: { streamName: "DOMAIN_EVENTS_DLQ" }
    }
  }]);
});

test("DLQ publish rejects an invalid or wrong-stream PubAck", async () => {
  for (const acknowledgement of [
    { stream: "WRONG", seq: 1, duplicate: false },
    { stream: "DOMAIN_EVENTS_DLQ", seq: 0, duplicate: false }
  ]) {
    const service = serviceFixture();
    setJetStream(service, { publish: async () => acknowledgement });
    await assert.rejects(
      service.publishDeadLetter("{}", "failure-id"),
      /invalid dead-letter PubAck/u
    );
  }
});

test("shutdown bounds a stalled drain and starts an immediate close fallback", async () => {
  let closeCalls = 0;
  const service = serviceFixture();
  setConnection(service, {
    drain: () => new Promise<void>(() => undefined),
    close: async () => {
      closeCalls += 1;
    }
  });
  setShutdownGrace(service, 100);

  const startedAt = performance.now();
  await Promise.race([
    service.onApplicationShutdown(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("shutdown timed out")), 500)
    )
  ]);

  assert.ok(performance.now() - startedAt < 450);
  assert.equal(closeCalls, 1);
});

test("shutdown does not force-close a connection after a successful drain", async () => {
  let drainCalls = 0;
  let closeCalls = 0;
  const service = serviceFixture();
  setConnection(service, {
    drain: async () => {
      drainCalls += 1;
    },
    close: async () => {
      closeCalls += 1;
    }
  });

  await service.onApplicationShutdown();

  assert.equal(drainCalls, 1);
  assert.equal(closeCalls, 0);
});

function serviceFixture(enabled = true): NatsService {
  return new NatsService({
    nats: { url: "nats://test" },
    eventConsumer: {
      enabled,
      ...(enabled
        ? {
            environment: "prod",
            streamName: "IDENTITY_EVENTS",
            durableName: "realtime_session_family_revoked_v1",
            subject: "prod.identity.session-family.revoked.v1",
            deadLetterStreamName: "DOMAIN_EVENTS_DLQ",
            deadLetterSubject:
              "prod.dlq.realtime.identity.session-family.revoked.v1"
          }
        : {}),
      fetchExpiresMs: 1_000,
      maxAttempts: 8,
      retryBaseMs: 1_000,
      retryMaxMs: 60_000,
      publishTimeoutMs: 5_000,
      maxPayloadBytes: 65_536,
      shutdownGraceMs: 10_000
    }
  } as AppConfig);
}

function managerFixture(options: {
  readonly streamRequests?: string[];
  readonly consumerRequests?: string[][];
  readonly sourceSubjects?: readonly string[];
  readonly deadLetterSubjects?: readonly string[];
  readonly sourceConfig?: Readonly<Record<string, unknown>>;
  readonly deadLetterConfig?: Readonly<Record<string, unknown>>;
  readonly consumer?: ConsumerInfo;
} = {}): JetStreamManager {
  return {
    streams: {
      info: async (streamName: string) => {
        options.streamRequests?.push(streamName);
        const source = streamName === "IDENTITY_EVENTS";
        return {
          config: streamConfigFixture(
            streamName,
            source
              ? options.sourceSubjects ?? [
                  "prod.identity.session-family.revoked.v1"
                ]
              : options.deadLetterSubjects ?? [
                  "prod.dlq.realtime.identity.session-family.revoked.v1"
                ],
            source ? options.sourceConfig : options.deadLetterConfig
          )
        };
      }
    },
    consumers: {
      info: async (streamName: string, consumerName: string) => {
        options.consumerRequests?.push([streamName, consumerName]);
        return options.consumer ?? consumerFixture();
      }
    }
  } as unknown as JetStreamManager;
}

function streamConfigFixture(
  name: string,
  subjects: readonly string[],
  config: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  const source = name === "IDENTITY_EVENTS";
  const maxMessages = source ? 1_000_000 : 100_000;
  return {
    name,
    subjects: [...subjects],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    discard: DiscardPolicy.New,
    max_consumers: 4,
    max_msgs: maxMessages,
    max_bytes: 512 * 1024 * 1024,
    max_age:
      (source ? 30 : 60) * 24 * 60 * 60 * 1_000_000_000,
    max_msgs_per_subject: maxMessages,
    num_replicas: 1,
    no_ack: false,
    deny_delete: true,
    deny_purge: true,
    allow_direct: false,
    allow_rollup_hdrs: false,
    discard_new_per_subject: false,
    sealed: false,
    max_msg_size: 65_536,
    duplicate_window: 2 * 60 * 60 * 1_000_000_000,
    ...config
  };
}

function consumerFixture(
  info: Partial<ConsumerInfo> = {},
  config: Readonly<Record<string, unknown>> = {}
): ConsumerInfo {
  return {
    stream_name: "IDENTITY_EVENTS",
    name: "realtime_session_family_revoked_v1",
    paused: false,
    config: {
      durable_name: "realtime_session_family_revoked_v1",
      name: "realtime_session_family_revoked_v1",
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      ack_wait: 60_000_000_000,
      max_deliver: -1,
      max_ack_pending: 1,
      max_waiting: 32,
      filter_subject: "prod.identity.session-family.revoked.v1",
      num_replicas: 1,
      mem_storage: false,
      ...config
    },
    ...info
  } as ConsumerInfo;
}

function setManager(service: NatsService, manager: JetStreamManager): void {
  (
    service as unknown as { jetStreamManager: JetStreamManager }
  ).jetStreamManager = manager;
}

function setConsumer(
  service: NatsService,
  consumer: Pick<Consumer, "fetch">
): void {
  (
    service as unknown as { eventConsumer: Pick<Consumer, "fetch"> }
  ).eventConsumer = consumer;
}

function setJetStream(
  service: NatsService,
  jetStream: Pick<JetStreamClient, "publish">
): void {
  (
    service as unknown as { jetStream: Pick<JetStreamClient, "publish"> }
  ).jetStream = jetStream;
}

function setConnection(
  service: NatsService,
  connection: Pick<NatsConnection, "drain" | "close">
): void {
  (
    service as unknown as { connection: NatsConnection }
  ).connection = connection as NatsConnection;
}

function setShutdownGrace(service: NatsService, value: number): void {
  const config = (
    service as unknown as { config: AppConfig }
  ).config;
  (
    config.eventConsumer as { shutdownGraceMs: number }
  ).shutdownGraceMs = value;
}
