import assert from "node:assert/strict";
import test from "node:test";
import {
  projectPresenceTtlMilliseconds,
  type ProjectPresenceParticipant
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import {
  PresenceStoreService,
  PROJECT_PRESENCE_REDIS_PREFIX
} from "./presence-store.service.js";

const PROJECT_ID = "0198f258-8cc7-7abc-8def-1234567890af";

test("stores exact presence state under a project key with a 30 second TTL", async () => {
  const redis = redisDouble();
  const store = presenceStore(redis.client);
  const participant = presenceParticipant();

  await store.onModuleInit();
  await store.put(PROJECT_ID, participant);

  const key = `${PROJECT_PRESENCE_REDIS_PREFIX}:${PROJECT_ID}:${participant.connectionId}`;
  assert.equal(redis.values.get(key), JSON.stringify(participant));
  assert.equal(redis.ttls.get(key), projectPresenceTtlMilliseconds);
  assert.deepEqual(await store.list(PROJECT_ID), [participant]);

  await store.remove(PROJECT_ID, participant.connectionId);
  assert.equal(redis.values.has(key), false);
  await store.onModuleDestroy();
  assert.equal(redis.connectCalls, 1);
  assert.equal(redis.closeCalls, 1);
});

test("drops malformed or key-mismatched ephemeral state", async () => {
  const redis = redisDouble();
  const store = presenceStore(redis.client);
  const malformedKey = `${PROJECT_PRESENCE_REDIS_PREFIX}:${PROJECT_ID}:bad_state`;
  redis.values.set(malformedKey, JSON.stringify({ keywordText: "secret" }));

  assert.deepEqual(await store.list(PROJECT_ID), []);
  assert.equal(redis.values.has(malformedKey), false);
});

test("fails closed when the bounded project connection directory overflows", async () => {
  const redis = redisDouble();
  const store = presenceStore(redis.client);
  for (let index = 0; index <= 500; index += 1) {
    redis.values.set(
      `${PROJECT_PRESENCE_REDIS_PREFIX}:${PROJECT_ID}:connection_${index}`,
      JSON.stringify(presenceParticipant(`connection_${index}`))
    );
  }

  await assert.rejects(
    store.list(PROJECT_ID),
    /connection limit reached/u
  );
});

function presenceStore(client: unknown): PresenceStoreService {
  return new PresenceStoreService(
    { redisUrl: "redis://unused" } as AppConfig,
    client as never
  );
}

function presenceParticipant(
  connectionId = "socket_connection_01"
): ProjectPresenceParticipant {
  return {
    connectionId,
    userId: "0198f258-8cc7-7abc-8def-1234567890ab",
    clientInstanceId: "0198f258-8cc7-7abc-8def-1234567890b1",
    route: "/app/semantics",
    status: "ACTIVE",
    cursor: null,
    selection: null,
    view: { kind: "SEMANTIC_CORE", groupIds: [] },
    editing: false,
    sequence: 1,
    updatedAt: "2026-08-20T10:00:00.000Z"
  };
}

function redisDouble() {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();
  let open = false;
  let connectCalls = 0;
  let closeCalls = 0;
  const client = {
    get isOpen() {
      return open;
    },
    on: () => undefined,
    connect: async () => {
      open = true;
      connectCalls += 1;
    },
    close: async () => {
      open = false;
      closeCalls += 1;
    },
    set: async (
      key: string,
      value: string,
      options: { readonly PX: number }
    ) => {
      values.set(key, value);
      ttls.set(key, options.PX);
    },
    del: async (key: string) => {
      values.delete(key);
      ttls.delete(key);
    },
    mGet: async (keys: readonly string[]) =>
      keys.map((key) => values.get(key) ?? null),
    async *scanIterator(options: { readonly MATCH: string }) {
      const prefix = options.MATCH.slice(0, -1);
      const matching = [...values.keys()].filter((key) =>
        key.startsWith(prefix)
      );
      for (let index = 0; index < matching.length; index += 100) {
        yield matching.slice(index, index + 100);
      }
    }
  };
  return {
    client,
    values,
    ttls,
    get connectCalls() {
      return connectCalls;
    },
    get closeCalls() {
      return closeCalls;
    }
  };
}
