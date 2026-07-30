import assert from "node:assert/strict";
import test from "node:test";
import type {
  JetStreamClient,
  JetStreamManager,
  JetStreamPublishOptions
} from "@nats-io/jetstream";
import type { AppConfig } from "../config/app-config.js";
import { NatsService } from "./nats.service.js";

test("publishes with the outbox id, bounded PubAck timeout and expected stream", async () => {
  const calls: Array<{
    readonly subject: string;
    readonly payload: string | Uint8Array | undefined;
    readonly options: Partial<JetStreamPublishOptions> | undefined;
  }> = [];
  const service = serviceFixture();
  setJetStream(service, {
    publish: async (subject, payload, options) => {
      calls.push({ subject, payload, options });
      return { stream: "IDENTITY_EVENTS", seq: 9, duplicate: false };
    }
  });

  const acknowledgement = await service.publishOutboxEvent(
    "prod.identity.session-family.revoked.v1",
    '{"eventId":"01900000-0000-7000-8000-000000000101"}',
    "01900000-0000-7000-8000-000000000101",
    "IDENTITY_EVENTS"
  );

  assert.deepEqual(acknowledgement, {
    stream: "IDENTITY_EVENTS",
    seq: 9,
    duplicate: false
  });
  assert.deepEqual(calls, [
    {
      subject: "prod.identity.session-family.revoked.v1",
      payload: '{"eventId":"01900000-0000-7000-8000-000000000101"}',
      options: {
        msgID: "01900000-0000-7000-8000-000000000101",
        timeout: 1_234,
        expect: { streamName: "IDENTITY_EVENTS" }
      }
    }
  ]);
});

test("readiness resolves the exact configured stream dynamically", async () => {
  const requested: string[] = [];
  const service = serviceFixture();
  setJetStreamManager(service, {
    streams: {
      info: async (streamName: string) => {
        requested.push(streamName);
        return {
          config: {
            name: streamName,
            subjects:
              streamName === "IDENTITY_EVENTS"
                ? ["prod.identity.session-family.revoked.v1"]
                : [
                    "prod.email.identity.email-verification.requested.v1",
                    "prod.email.identity.password-reset.requested.v1",
                    "prod.email.workspace.invite.requested.v1"
                  ]
          }
        };
      }
    }
  });

  await service.assertOutboxStream();
  assert.deepEqual(requested, ["IDENTITY_EVENTS", "AUTH_EMAIL_EVENTS"]);
});

test("readiness rejects a mismatched stream identity", async () => {
  const service = serviceFixture();
  setJetStreamManager(service, {
    streams: {
      info: async () => ({ config: { name: "ANOTHER_STREAM" } })
    }
  });

  await assert.rejects(
    service.assertOutboxStream(),
    /JetStream outbox stream identity mismatch/u
  );
});

test("readiness rejects wildcard, unrelated and additional stream subjects", async () => {
  for (const subjects of [
    ["prod.identity.>"],
    ["prod.billing.entitlement.changed.v1"],
    [
      "prod.identity.session-family.revoked.v1",
      "prod.identity.user.created.v1"
    ]
  ]) {
    const service = serviceFixture();
    setJetStreamManager(service, {
      streams: {
        info: async () => ({
          config: { name: "IDENTITY_EVENTS", subjects }
        })
      }
    });

    await assert.rejects(
      service.assertOutboxStream(),
      /stream subject scope mismatch/u
    );
  }
});

test("readiness rejects a broadened or incomplete auth-email stream", async () => {
  for (const subjects of [
    ["prod.email.>"],
    [
      "prod.email.identity.email-verification.requested.v1",
      "prod.email.identity.password-reset.requested.v1"
    ]
  ]) {
    const service = serviceFixture();
    setJetStreamManager(service, {
      streams: {
        info: async (streamName: string) => ({
          config: {
            name: streamName,
            subjects:
              streamName === "IDENTITY_EVENTS"
                ? ["prod.identity.session-family.revoked.v1"]
                : subjects
          }
        })
      }
    });
    await assert.rejects(
      service.assertOutboxStream(),
      /stream subject scope mismatch/u
    );
  }
});

test("disabled publisher neither requires JetStream nor permits publishing", async () => {
  const service = serviceFixture(false);

  await service.assertOutboxStream();
  await assert.rejects(
    service.publishOutboxEvent(
      "test.subject",
      "{}",
      "event-id",
      "IDENTITY_EVENTS"
    ),
    /not initialized/u
  );
});

function serviceFixture(enabled = true): NatsService {
  return new NatsService({
    outboxPublisher: {
      enabled,
      ...(enabled
        ? {
            eventEnvironment: "prod",
            streamName: "IDENTITY_EVENTS",
            authEmailStreamName: "AUTH_EMAIL_EVENTS"
          }
        : {}),
      pollIntervalMs: 1_000,
      batchSize: 20,
      maxAttempts: 10,
      retryBaseMs: 1_000,
      retryMaxMs: 300_000,
      publishTimeoutMs: 1_234
    }
  } as AppConfig);
}

function setJetStream(
  service: NatsService,
  jetStream: Pick<JetStreamClient, "publish">
): void {
  (
    service as unknown as { jetStream: Pick<JetStreamClient, "publish"> }
  ).jetStream = jetStream;
}

function setJetStreamManager(
  service: NatsService,
  manager: {
    readonly streams: {
      info(streamName: string): Promise<{
        config: { name: string; subjects?: readonly string[] };
      }>;
    };
  }
): void {
  (
    service as unknown as {
      jetStreamManager: Pick<JetStreamManager, "streams">;
    }
  ).jetStreamManager = manager as unknown as Pick<
    JetStreamManager,
    "streams"
  >;
}
