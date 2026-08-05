import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setImmediate as setImmediatePromise } from "node:timers/promises";
import test from "node:test";
import { RedisAdapter } from "@socket.io/redis-adapter";
import type { RedisClientType } from "redis";
import type { Server as SocketIoServer } from "socket.io";
import {
  COLLABORATION_NAMESPACE,
  createRealtimeRedisAdapter,
  REALTIME_REDIS_ADAPTER_KEY,
  RedisIoAdapter
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

test("a real Socket.IO server installs Redis only for collaboration", async () => {
  const context = await realSocketIoContext();

  try {
    await context.adapter.waitUntilReady();

    const rootAdapter = context.io.of("/").adapter;
    const collaborationAdapter = context.io.of(
      COLLABORATION_NAMESPACE
    ).adapter;
    assert.equal(rootAdapter instanceof RedisAdapter, false);
    assert.ok(collaborationAdapter instanceof RedisAdapter);
    assert.deepEqual(context.redis.patternSubscriptions, [
      {
        pattern: `${BROADCAST_CHANNEL}*`,
        returnBuffers: true
      }
    ]);
    assert.deepEqual(context.redis.channelSubscriptions, [
      {
        channels: [
          REQUEST_CHANNEL,
          RESPONSE_CHANNEL,
          `${RESPONSE_CHANNEL}${collaborationAdapter.uid}#`
        ],
        returnBuffers: true
      }
    ]);
    assert.equal(
      context.redis.subscribedChannels.some((channel) =>
        channel.includes("#/#")
      ),
      false
    );

    const subscriptionCount =
      context.redis.patternSubscriptions.length +
      context.redis.channelSubscriptions.length;
    assert.throws(
      () => context.adapter.createIOServer(0),
      /more than once/
    );
    assert.equal(
      context.redis.patternSubscriptions.length +
        context.redis.channelSubscriptions.length,
      subscriptionCount
    );
  } finally {
    await closeRealSocketIoContext(context);
  }
});

test("subscription denial fails startup without an unhandled rejection", async () => {
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  const context = await realSocketIoContext({
    patternSubscriptionError: new Error("redis acl denied")
  });

  try {
    await assert.rejects(
      context.adapter.waitUntilReady(),
      /Redis subscriptions failed during startup/
    );
    await setImmediatePromise();

    assert.deepEqual(unhandledRejections, []);
    assert.equal(context.redis.publisherState.isOpen, false);
    assert.equal(context.redis.subscriberState.isOpen, false);
    assert.equal(context.redis.publisherState.closeCalls, 1);
    assert.equal(context.redis.subscriberState.closeCalls, 1);
  } finally {
    await context.io.close();
    await context.adapter
      .closeConnections()
      .catch(() => undefined);
    await setImmediatePromise();
    process.off("unhandledRejection", onUnhandledRejection);
  }

  assert.deepEqual(unhandledRejections, []);
});

test("a partial Redis connect failure destroys every opened client", async () => {
  const httpServer = createServer();
  const redis = lifecycleRedisHarness({
    subscriberConnectError: new Error("subscriber unavailable")
  });
  const adapter = new RedisIoAdapter(
    httpServer,
    "redis://unused",
    redis
  );

  await assert.rejects(
    adapter.connect(),
    /Redis clients failed to connect/
  );
  assert.equal(redis.publisherState.destroyCalls, 1);
  assert.equal(redis.subscriberState.destroyCalls, 1);
  assert.equal(redis.publisherState.isOpen, false);
  assert.equal(redis.subscriberState.isOpen, false);
  assert.throws(
    () => adapter.createIOServer(0),
    /not initialized/
  );

  await adapter.closeConnections();
});

test("cleanup is idempotent and closes both Redis clients after one close failure", async () => {
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  const context = await realSocketIoContext({
    publisherCloseError: new Error("publisher close failed"),
    cleanupError: new Error("redis unsubscribe failed")
  });

  try {
    await context.adapter.waitUntilReady();

    const firstClose = context.adapter.closeConnections();
    const secondClose = context.adapter.closeConnections();
    assert.equal(firstClose, secondClose);
    await assert.rejects(firstClose, AggregateError);
    await setImmediatePromise();

    assert.equal(context.redis.publisherState.closeCalls, 1);
    assert.equal(context.redis.publisherState.destroyCalls, 1);
    assert.equal(context.redis.subscriberState.closeCalls, 1);
    assert.equal(context.redis.subscriberState.isOpen, false);
    assert.deepEqual(unhandledRejections, []);
  } finally {
    await context.io.close();
    await setImmediatePromise();
    process.off("unhandledRejection", onUnhandledRejection);
  }

  assert.deepEqual(unhandledRejections, []);
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

interface LifecycleClientState {
  isOpen: boolean;
  connectCalls: number;
  closeCalls: number;
  destroyCalls: number;
}

interface LifecycleRedisOptions {
  readonly subscriberConnectError?: Error;
  readonly patternSubscriptionError?: Error;
  readonly publisherCloseError?: Error;
  readonly cleanupError?: Error;
}

interface LifecycleRedisHarness {
  readonly publisher: RedisClientType;
  readonly subscriber: RedisClientType;
  readonly publisherState: LifecycleClientState;
  readonly subscriberState: LifecycleClientState;
  readonly patternSubscriptions: PatternSubscriptionCall[];
  readonly channelSubscriptions: SubscriptionCall[];
  readonly subscribedChannels: readonly string[];
}

interface RealSocketIoContext {
  readonly adapter: RedisIoAdapter;
  readonly io: SocketIoServer;
  readonly redis: LifecycleRedisHarness;
}

async function realSocketIoContext(
  options: LifecycleRedisOptions = {}
): Promise<RealSocketIoContext> {
  const httpServer = createServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    httpServer.once("error", onError);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", onError);
      resolve();
    });
  });

  const redis = lifecycleRedisHarness(options);
  const adapter = new RedisIoAdapter(
    httpServer,
    "redis://unused",
    redis
  );
  try {
    await adapter.connect();
    const io = adapter.createIOServer(0) as SocketIoServer;
    return { adapter, io, redis };
  } catch (error) {
    await adapter.closeConnections().catch(() => undefined);
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    throw error;
  }
}

async function closeRealSocketIoContext(
  context: RealSocketIoContext
): Promise<void> {
  await context.io.close();
  await context.adapter.closeConnections();
}

function lifecycleRedisHarness(
  options: LifecycleRedisOptions = {}
): LifecycleRedisHarness {
  const publisherState = clientState();
  const subscriberState = clientState();
  const patternSubscriptions: PatternSubscriptionCall[] = [];
  const channelSubscriptions: SubscriptionCall[] = [];
  let publisher = undefined as unknown as RedisClientType;
  let subscriber = undefined as unknown as RedisClientType;

  const publisherTarget = {
    get isOpen() {
      return publisherState.isOpen;
    },
    connect: async () => {
      publisherState.connectCalls += 1;
      publisherState.isOpen = true;
      return publisher;
    },
    close: async () => {
      publisherState.closeCalls += 1;
      if (options.publisherCloseError) {
        throw options.publisherCloseError;
      }
      publisherState.isOpen = false;
    },
    destroy: () => {
      publisherState.destroyCalls += 1;
      publisherState.isOpen = false;
    },
    duplicate: () => subscriber,
    pSubscribe: async () => undefined,
    publish: async () => 1,
    on: () => publisher,
    off: () => publisher
  };
  const subscriberTarget = {
    get isOpen() {
      return subscriberState.isOpen;
    },
    connect: async () => {
      subscriberState.connectCalls += 1;
      subscriberState.isOpen = true;
      if (options.subscriberConnectError) {
        throw options.subscriberConnectError;
      }
      return subscriber;
    },
    close: async () => {
      subscriberState.closeCalls += 1;
      subscriberState.isOpen = false;
    },
    destroy: () => {
      subscriberState.destroyCalls += 1;
      subscriberState.isOpen = false;
    },
    pSubscribe: async (
      pattern: string,
      _listener: SubscriptionListener,
      returnBuffers: boolean
    ) => {
      patternSubscriptions.push({ pattern, returnBuffers });
      if (options.patternSubscriptionError) {
        throw options.patternSubscriptionError;
      }
    },
    subscribe: async (
      channels: readonly string[],
      _listener: SubscriptionListener,
      returnBuffers: boolean
    ) => {
      channelSubscriptions.push({
        channels: [...channels],
        returnBuffers
      });
    },
    pUnsubscribe: async () => {
      if (options.cleanupError) throw options.cleanupError;
    },
    unsubscribe: async () => {
      if (options.cleanupError) throw options.cleanupError;
    },
    on: () => subscriber,
    off: () => subscriber
  };

  publisher = publisherTarget as unknown as RedisClientType;
  subscriber = subscriberTarget as unknown as RedisClientType;
  return {
    publisher,
    subscriber,
    publisherState,
    subscriberState,
    patternSubscriptions,
    channelSubscriptions,
    get subscribedChannels() {
      return [
        ...patternSubscriptions.map(({ pattern }) => pattern),
        ...channelSubscriptions.flatMap(({ channels }) => channels)
      ];
    }
  };
}

function clientState(): LifecycleClientState {
  return {
    isOpen: false,
    connectCalls: 0,
    closeCalls: 0,
    destroyCalls: 0
  };
}
