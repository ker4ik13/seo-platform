import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient, type RedisClientType } from "redis";
import type { ServerOptions } from "socket.io";

export class RedisIoAdapter extends IoAdapter {
  private readonly publisher: RedisClientType;
  private readonly subscriber: RedisClientType;
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  public constructor(app: ConstructorParameters<typeof IoAdapter>[0], url: string) {
    super(app);
    this.publisher = createClient({ url });
    this.subscriber = this.publisher.duplicate();
  }

  public async connect(): Promise<void> {
    await Promise.all([
      this.publisher.connect(),
      this.subscriber.connect()
    ]);
    this.adapterConstructor = createAdapter(this.publisher, this.subscriber);
  }

  public override createIOServer(
    port: number,
    options?: ServerOptions
  ): ReturnType<IoAdapter["createIOServer"]> {
    const server = super.createIOServer(port, options);
    if (!this.adapterConstructor) {
      throw new Error("Socket.IO Redis adapter is not initialized");
    }
    server.adapter(this.adapterConstructor);
    return server;
  }

  public async closeConnections(): Promise<void> {
    await Promise.all([
      this.publisher.isOpen
        ? this.publisher.close()
        : Promise.resolve(),
      this.subscriber.isOpen
        ? this.subscriber.close()
        : Promise.resolve()
    ]);
  }
}
