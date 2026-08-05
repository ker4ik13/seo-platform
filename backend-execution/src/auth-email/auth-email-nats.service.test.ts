import assert from "node:assert/strict";
import test from "node:test";
import {
  transactionalEmailDeadLetterSubjectV1,
  transactionalEmailEventFilterSubjectV1,
  transactionalEmailEventSubjectV1,
  transactionalEmailEventTypesV1
} from "@seo-platform/contracts";
import {
  AckPolicy,
  DeliverPolicy,
  DiscardPolicy,
  RetentionPolicy,
  ReplayPolicy,
  StorageType,
  type JetStreamManager
} from "@nats-io/jetstream";
import type { AppConfig } from "../config/app-config.js";
import { AuthEmailNatsService } from "./auth-email-nats.service.js";

test("accepts only the provisioned auth-email source, durable and DLQ topology", async () => {
  const topology = topologyFixture();
  const service = natsService(topology.manager);

  await service.assertTopology();

  topology.source.config.subjects = [
    transactionalEmailEventFilterSubjectV1("test")
  ];
  await assert.rejects(
    () => service.assertTopology(),
    /source topology mismatch/u
  );
});

test("rejects a weakened consumer or DLQ topology", async () => {
  const consumerTopology = topologyFixture();
  consumerTopology.consumer.config.max_ack_pending = 17;
  await assert.rejects(
    () => natsService(consumerTopology.manager).assertTopology(),
    /durable consumer topology mismatch/u
  );

  const dlqTopology = topologyFixture();
  dlqTopology.deadLetter.config.deny_purge = false;
  await assert.rejects(
    () => natsService(dlqTopology.manager).assertTopology(),
    /dead-letter topology mismatch/u
  );
});

function topologyFixture() {
  const source = streamConfig(
    "AUTH_EMAIL_EVENTS",
    Object.values(transactionalEmailEventTypesV1).map((eventType) =>
      transactionalEmailEventSubjectV1("test", eventType)
    ),
    2,
    1_000_000,
    30,
    500_000
  );
  const deadLetter = streamConfig(
    "DOMAIN_EVENTS_DLQ",
    [
      "test.dlq.realtime.identity.session-family.revoked.v1",
      transactionalEmailDeadLetterSubjectV1("test")
    ],
    4,
    100_000,
    60,
    100_000
  );
  const consumer = {
    stream_name: "AUTH_EMAIL_EVENTS",
    name: "jobs_auth_email_v1",
    paused: false,
    config: {
      durable_name: "jobs_auth_email_v1",
      name: "jobs_auth_email_v1",
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      replay_policy: ReplayPolicy.Instant,
      ack_wait: 60 * 1_000_000_000,
      filter_subject: transactionalEmailEventFilterSubjectV1("test"),
      max_ack_pending: 16,
      max_waiting: 32,
      max_deliver: -1,
      num_replicas: 1
    }
  };
  const manager = {
    streams: {
      info: async (name: string) =>
        name === "AUTH_EMAIL_EVENTS" ? source : deadLetter
    },
    consumers: {
      info: async () => consumer
    }
  } as unknown as JetStreamManager;
  return { source, deadLetter, consumer, manager };
}

function streamConfig(
  name: string,
  subjects: string[],
  maxConsumers: number,
  maxMessages: number,
  maxAgeDays: number,
  maxMessagesPerSubject: number
) {
  return {
    config: {
      name,
      subjects,
      storage: StorageType.File,
      retention: RetentionPolicy.Limits,
      discard: DiscardPolicy.New,
      max_consumers: maxConsumers,
      max_msgs: maxMessages,
      max_bytes: 512 * 1_024 * 1_024,
      max_age: maxAgeDays * 24 * 60 * 60 * 1_000_000_000,
      max_msgs_per_subject: maxMessagesPerSubject,
      num_replicas: 1,
      deny_delete: true,
      deny_purge: true,
      max_msg_size: 65_536,
      duplicate_window: 2 * 60 * 60 * 1_000_000_000
    }
  };
}

function natsService(manager: JetStreamManager): AuthEmailNatsService {
  const service = new AuthEmailNatsService({
    authEmail: {
      enabled: true,
      environment: "test",
      streamName: "AUTH_EMAIL_EVENTS",
      durableName: "jobs_auth_email_v1",
      deadLetterStreamName: "DOMAIN_EVENTS_DLQ",
      fetchExpiresMs: 30_000,
      publishTimeoutMs: 5_000,
      shutdownGraceMs: 10_000
    }
  } as AppConfig);
  (service as unknown as { manager: JetStreamManager }).manager = manager;
  return service;
}
