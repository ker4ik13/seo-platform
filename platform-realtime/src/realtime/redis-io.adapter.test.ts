import assert from "node:assert/strict";
import { setImmediate as setImmediatePromise } from "node:timers/promises";
import test from "node:test";
import type { RedisAdapter } from "@socket.io/redis-adapter";
import type { RedisClientType } from "redis";
import {
  createRealtimeRedisAdapter,
  REALTIME_REDIS_ADAPTER_KEY
} from "./redis-io.adapter.js";

const NAMESPACE = "/collaboration";
const BROADCAST_CHANNEL =
  "seo-platform:realtime:v1#/collaboration#";
const REQUEST_CHANNEL =
  "seo-platform:realtime:v1-request#/collaboration#";
const RESPONSE_CHANNEL =
  "seo-platform:realtime:v1-response#/collaboration#";

test("uses the exact versioned Socket.IO channels and specific response option", () => {
  const redis = redisHarness();
  const adapter = createAdapter(redis);

  assert.equal(
    REALTIME_REDIS_ADAPTER_KEY,
    "seo-platform:realtime:v1"
  );
  assert.equal(adapter.publishOnSpecificResponseChannel, true);
  assert.deepEqual(redis.patternSubscriptions, [
    {
      pattern: `${BROADCAST_CHANNEL}*`,
      returnBuffers: true
    }
  ]);
  assert.deepEqual(redis.channelSubscriptions, [
    {
      channels: [
        REQUEST_CHANNEL,
        RESPONSE_CHANNEL,
        `${RESPONSE_CHANNEL}${adapter.uid}#`
      ],
      returnBuffers: true
    }
  ]);
  assert.deepEqual(redis.forbiddenKeyAccesses, []);
  assert.equal(
    redis.subscribedChannels.some((channel) =>
      channel.includes("presence")
    ),
    false
  );

  adapter.close();
});

test("publishes broadcasts and request replies only on the exact versioned channels", async () => {
  const redis = redisHarness();
  const adapter = createAdapter(redis);

  adapter.broadcast(
    {
      type: 2,
      data: ["realtime-regression"]
    },
    {
      rooms: new Set(),
      except: new Set(),
      flags: {}
    }
  );

  const requestListener = redis.requestListener;
  assert.ok(requestListener);
  requestListener(
    Buffer.from(
      JSON.stringify({
        uid: "requesting-node",
        requestId: "request-1",
        type: 1
      })
    ),
    REQUEST_CHANNEL
  );
  await setImmediatePromise();

  assert.deepEqual(
    redis.publications.map(({ channel }) => channel),
    [
      BROADCAST_CHANNEL,
      `${RESPONSE_CHANNEL}requesting-node#`
    ]
  );
  assert.deepEqual(redis.forbiddenKeyAccesses, []);
  assert.equal(
    redis.publications.some(({ channel }) =>
      channel.includes("presence")
    ),
    false
  );

  adapter.close();
});

interface SubscriptionCall {
  readonly channels: readonly string[];
  readonly returnBuffers: boolean;
}

interface PatternSubscriptionCall {
  readonly pattern: string;
  readonly returnBuffers: boolean;
}

interface Publication {
  readonly channel: string;
  readonly payload: string | Buffer;
}

type SubscriptionListener = (
  message: Buffer,
  channel: string
) => void;

interface RedisHarness {
  readonly publisher: RedisClientType;
  readonly subscriber: RedisClientType;
  readonly patternSubscriptions: PatternSubscriptionCall[];
  readonly channelSubscriptions: SubscriptionCall[];
  readonly publications: Publication[];
  readonly forbiddenKeyAccesses: string[];
  readonly subscribedChannels: readonly string[];
  readonly requestListener: SubscriptionListener | undefined;
}

function createAdapter(redis: RedisHarness): RedisAdapter {
  return createRealtimeRedisAdapter(
    redis.publisher,
    redis.subscriber
  )(namespaceFixture());
}

function redisHarness(): RedisHarness {
  const patternSubscriptions: PatternSubscriptionCall[] = [];
  const channelSubscriptions: SubscriptionCall[] = [];
  const publications: Publication[] = [];
  const forbiddenKeyAccesses: string[] = [];
  let requestListener: SubscriptionListener | undefined;
  let publisher = undefined as unknown as RedisClientType;
  let subscriber = undefined as unknown as RedisClientType;

  const publisherTarget = {
    pSubscribe: async () => undefined,
    publish: async (channel: string, payload: string | Buffer) => {
      publications.push({ channel, payload });
      return 1;
    },
    on: () => publisher,
    off: () => publisher
  };
  const subscriberTarget = {
    pSubscribe: async (
      pattern: string,
      _listener: SubscriptionListener,
      returnBuffers: boolean
    ) => {
      patternSubscriptions.push({ pattern, returnBuffers });
    },
    subscribe: async (
      channels: readonly string[],
      listener: SubscriptionListener,
      returnBuffers: boolean
    ) => {
      channelSubscriptions.push({
        channels: [...channels],
        returnBuffers
      });
      requestListener = listener;
    },
    pUnsubscribe: async () => undefined,
    unsubscribe: async () => undefined,
    on: () => subscriber,
    off: () => subscriber
  };
  publisher = guardedRedisClient(
    publisherTarget,
    forbiddenKeyAccesses
  );
  subscriber = guardedRedisClient(
    subscriberTarget,
    forbiddenKeyAccesses
  );

  return {
    publisher,
    subscriber,
    patternSubscriptions,
    channelSubscriptions,
    publications,
    forbiddenKeyAccesses,
    get subscribedChannels() {
      return [
        ...patternSubscriptions.map(({ pattern }) => pattern),
        ...channelSubscriptions.flatMap(({ channels }) => channels)
      ];
    },
    get requestListener() {
      return requestListener;
    }
  };
}

function guardedRedisClient(
  target: object,
  forbiddenKeyAccesses: string[]
): RedisClientType {
  const forbiddenMethods = new Set([
    "del",
    "expire",
    "get",
    "hGet",
    "hSet",
    "set",
    "unlink"
  ]);
  return new Proxy(target, {
    get(current, property, receiver) {
      if (
        typeof property === "string" &&
        forbiddenMethods.has(property)
      ) {
        forbiddenKeyAccesses.push(property);
      }
      return Reflect.get(current, property, receiver);
    }
  }) as RedisClientType;
}

function namespaceFixture(): {
  readonly name: string;
  readonly server: {
    readonly encoder: {
      encode(): readonly string[];
    };
  };
  readonly sockets: Map<never, never>;
  _ids: number;
  _onServerSideEmit(): void;
} {
  return {
    name: NAMESPACE,
    server: {
      encoder: {
        encode: () => []
      }
    },
    sockets: new Map<never, never>(),
    _ids: 0,
    _onServerSideEmit: () => undefined
  };
}
