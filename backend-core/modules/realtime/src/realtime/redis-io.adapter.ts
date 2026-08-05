import { IoAdapter } from "@nestjs/platform-socket.io";
import {
  createAdapter,
  type RedisAdapter
} from "@socket.io/redis-adapter";
import { createClient, type RedisClientType } from "redis";
import type { Namespace, Server, ServerOptions } from "socket.io";

export const COLLABORATION_NAMESPACE = "/collaboration";
export const REALTIME_REDIS_ADAPTER_KEY = "seo-platform:realtime:v1";

const STARTUP_SUBSCRIPTION_COUNT = 2;
const STARTUP_METHODS = new Set(["pSubscribe", "subscribe"]);
const CLEANUP_METHODS = new Set(["pUnsubscribe", "unsubscribe"]);

export function createRealtimeRedisAdapter(
  publisher: RedisClientType,
  subscriber: RedisClientType
): ReturnType<typeof createAdapter> {
  return createAdapter(publisher, subscriber, {
    key: REALTIME_REDIS_ADAPTER_KEY,
    publishOnSpecificResponseChannel: true
  });
}

interface RedisIoAdapterClients {
  readonly publisher: RedisClientType;
  readonly subscriber: RedisClientType;
}

class SubscriptionLifecycle {
  public readonly client: RedisClientType;

  private readonly startupOperations: Promise<unknown>[] = [];
  private readonly cleanupOperations: Promise<unknown>[] = [];
  private installationStarted = false;

  public constructor(client: RedisClientType) {
    this.client = new Proxy(client, {
      get: (target, property) => {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;

        if (
          typeof property === "string" &&
          STARTUP_METHODS.has(property)
        ) {
          return (...args: unknown[]) => {
            const operation = this.invoke(target, value, args);
            this.startupOperations.push(operation);
            return operation;
          };
        }

        if (
          typeof property === "string" &&
          CLEANUP_METHODS.has(property)
        ) {
          return (...args: unknown[]) => {
            const operation = this.invoke(target, value, args);
            this.cleanupOperations.push(operation);
            return operation;
          };
        }

        return value.bind(target);
      }
    }) as RedisClientType;
  }

  public beginInstallation(): void {
    if (this.installationStarted) {
      throw new Error(
        "Socket.IO Redis adapter installation was attempted more than once"
      );
    }
    this.installationStarted = true;
  }

  public async waitUntilReady(): Promise<void> {
    if (!this.installationStarted) {
      throw new Error("Socket.IO Redis adapter is not installed");
    }
    if (
      this.startupOperations.length !==
      STARTUP_SUBSCRIPTION_COUNT
    ) {
      throw new Error(
        "Socket.IO Redis adapter did not start the expected subscriptions"
      );
    }
    await Promise.all(this.startupOperations);
  }

  public async waitForCleanup(): Promise<readonly unknown[]> {
    const results = await Promise.allSettled(
      this.cleanupOperations
    );
    return results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
  }

  private invoke(
    target: RedisClientType,
    operation: (...args: unknown[]) => unknown,
    args: unknown[]
  ): Promise<unknown> {
    let result: Promise<unknown>;
    try {
      result = Promise.resolve(operation.apply(target, args));
    } catch (error) {
      result = Promise.reject(error);
    }

    // The Redis adapter does not await these operations. Attaching a rejection
    // handler here prevents process-level unhandled rejections while preserving
    // the original rejected promise for the explicit readiness/cleanup checks.
    void result.catch(() => undefined);
    return result;
  }
}

export class RedisIoAdapter extends IoAdapter {
  private readonly publisher: RedisClientType;
  private readonly subscriber: RedisClientType;
  private readonly subscriptions: SubscriptionLifecycle;
  private adapterConstructor:
    | ReturnType<typeof createAdapter>
    | undefined;
  private adapterInitialization: Promise<void> | undefined;
  private collaborationAdapter?: RedisAdapter;
  private connectAttempt?: Promise<void>;
  private readinessAttempt?: Promise<void>;
  private closeAttempt?: Promise<void>;
  private server?: Server;
  private connected = false;
  private ready = false;
  private closed = false;

  public constructor(
    app: ConstructorParameters<typeof IoAdapter>[0],
    url: string,
    clients?: RedisIoAdapterClients
  ) {
    super(app);
    this.publisher =
      clients?.publisher ?? createClient({ url });
    this.subscriber =
      clients?.subscriber ?? this.publisher.duplicate();
    this.subscriptions = new SubscriptionLifecycle(
      this.subscriber
    );
    this.publisher.on("error", ignoreRedisError);
    this.subscriber.on("error", ignoreRedisError);
  }

  public connect(): Promise<void> {
    if (this.closed) {
      return Promise.reject(
        new Error("Socket.IO Redis adapter is closed")
      );
    }
    if (this.connected) return Promise.resolve();
    if (this.connectAttempt) return this.connectAttempt;

    const attempt = this.connectClients();
    this.connectAttempt = attempt;
    void attempt.catch(() => undefined);
    return attempt;
  }

  public override createIOServer(
    port: number,
    options?: ServerOptions
  ): ReturnType<IoAdapter["createIOServer"]> {
    if (
      this.closed ||
      !this.connected ||
      !this.adapterConstructor
    ) {
      throw new Error("Socket.IO Redis adapter is not initialized");
    }
    if (this.server) {
      throw new Error(
        "Socket.IO server creation was attempted more than once"
      );
    }

    const server = super.createIOServer(
      port,
      options
    ) as Server;
    try {
      this.subscriptions.beginInstallation();
      const namespace = server.of(COLLABORATION_NAMESPACE);
      this.installCollaborationAdapter(namespace);
      this.server = server;
      return server;
    } catch (error) {
      this.closed = true;
      this.connected = false;
      this.destroyOpenClients();
      void server.close().catch(() => undefined);
      throw error;
    }
  }

  public waitUntilReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.readinessAttempt) return this.readinessAttempt;

    const attempt = this.confirmReadiness();
    this.readinessAttempt = attempt;
    void attempt.catch(() => undefined);
    return attempt;
  }

  public closeConnections(): Promise<void> {
    if (this.closeAttempt) return this.closeAttempt;

    this.closed = true;
    const attempt = this.closeResources();
    this.closeAttempt = attempt;
    void attempt.catch(() => undefined);
    return attempt;
  }

  private async connectClients(): Promise<void> {
    try {
      const results = await Promise.allSettled([
        this.publisher.connect(),
        this.subscriber.connect()
      ]);
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "Socket.IO Redis clients failed to connect"
        );
      }
      if (this.closed) {
        throw new Error(
          "Socket.IO Redis adapter was closed while connecting"
        );
      }
      this.adapterConstructor = createRealtimeRedisAdapter(
        this.publisher,
        this.subscriptions.client
      );
      this.connected = true;
    } catch (error) {
      this.adapterConstructor = undefined;
      this.connected = false;
      this.destroyOpenClients();
      throw new Error(
        "Socket.IO Redis clients failed to connect",
        { cause: error }
      );
    }
  }

  private installCollaborationAdapter(
    namespace: Namespace
  ): void {
    const previousAdapter = namespace.adapter;
    const redisAdapter = this.adapterConstructor?.(namespace);
    if (!redisAdapter) {
      throw new Error("Socket.IO Redis adapter is not initialized");
    }

    let adapterClosed = false;
    const closeAdapter = redisAdapter.close.bind(redisAdapter);
    redisAdapter.close = () => {
      if (adapterClosed) return;
      adapterClosed = true;
      return closeAdapter();
    };

    namespace.adapter = redisAdapter;
    this.collaborationAdapter = redisAdapter;
    const initialization = Promise.resolve(redisAdapter.init());
    void initialization.catch(() => undefined);
    this.adapterInitialization = initialization;
    void Promise.resolve(previousAdapter.close()).catch(
      () => undefined
    );
  }

  private async confirmReadiness(): Promise<void> {
    if (!this.collaborationAdapter || !this.server) {
      throw new Error("Socket.IO Redis adapter is not installed");
    }

    try {
      await Promise.all([
        this.subscriptions.waitUntilReady(),
        this.adapterInitialization
      ]);
      if (
        this.closed ||
        this.server
          .of(COLLABORATION_NAMESPACE)
          .adapter !== this.collaborationAdapter
      ) {
        throw new Error(
          "Socket.IO Redis adapter became unavailable during startup"
        );
      }
      this.ready = true;
    } catch (error) {
      await this.closeConnections().catch(() => undefined);
      throw new Error(
        "Socket.IO Redis subscriptions failed during startup",
        { cause: error }
      );
    }
  }

  private async closeResources(): Promise<void> {
    const failures: unknown[] = [];

    try {
      await this.collaborationAdapter?.close();
    } catch (error) {
      failures.push(error);
    }
    failures.push(...(await this.subscriptions.waitForCleanup()));

    const closeResults = await Promise.allSettled([
      this.closeClient(this.publisher),
      this.closeClient(this.subscriber)
    ]);
    for (const result of closeResults) {
      if (result.status === "rejected") {
        failures.push(result.reason);
      }
    }

    this.connected = false;
    this.ready = false;
    this.adapterConstructor = undefined;

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Socket.IO Redis resources failed to close cleanly"
      );
    }
  }

  private async closeClient(client: RedisClientType): Promise<void> {
    if (!client.isOpen) return;
    try {
      await client.close();
    } catch (error) {
      if (client.isOpen) {
        try {
          client.destroy();
        } catch {
          // The original close failure remains the actionable cause.
        }
      }
      throw error;
    }
  }

  private destroyOpenClients(): void {
    for (const client of [this.publisher, this.subscriber]) {
      if (!client.isOpen) continue;
      try {
        client.destroy();
      } catch {
        // Connection failure is preserved as the startup cause.
      }
    }
  }
}

function ignoreRedisError(): void {
  // Redis command/connect promises are checked explicitly. This listener keeps
  // EventEmitter errors from terminating the process before those checks run.
}
