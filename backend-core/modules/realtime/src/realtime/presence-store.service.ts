import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import {
  projectPresenceMaximumConnections,
  projectPresenceParticipant,
  projectPresenceTtlMilliseconds,
  type ProjectPresenceParticipant
} from "@seo-platform/contracts";
import { createClient, type RedisClientType } from "redis";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

export const PROJECT_PRESENCE_REDIS_PREFIX =
  "seo-platform:realtime:v1:presence";

interface PresenceRedisClient {
  readonly isOpen: boolean;
  on(event: "error", listener: () => void): unknown;
  connect(): Promise<unknown>;
  close(): Promise<unknown>;
  set(
    key: string,
    value: string,
    options: Readonly<{ PX: number }>
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
  mGet(keys: readonly string[]): Promise<readonly (string | null)[]>;
  scanIterator(options: Readonly<{
    MATCH: string;
    COUNT: number;
  }>): AsyncGenerator<readonly string[], void, unknown>;
}

@Injectable()
export class PresenceStoreService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly client: PresenceRedisClient;

  public constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() client?: PresenceRedisClient
  ) {
    this.client =
      client ??
      (createClient({ url: config.redisUrl }) as RedisClientType as PresenceRedisClient);
    this.client.on("error", ignoreRedisError);
  }

  public async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  public async put(
    projectId: string,
    participant: ProjectPresenceParticipant
  ): Promise<void> {
    const value = projectPresenceParticipant(participant);
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > 8 * 1_024) {
      throw new Error("Presence state exceeds its storage boundary");
    }
    await this.client.set(
      presenceKey(projectId, value.connectionId),
      serialized,
      { PX: projectPresenceTtlMilliseconds }
    );
  }

  public async list(
    projectId: string
  ): Promise<readonly ProjectPresenceParticipant[]> {
    const prefix = presenceProjectPrefix(projectId);
    const seenKeys = new Set<string>();
    const participants = new Map<string, ProjectPresenceParticipant>();
    for await (const scannedKeys of this.client.scanIterator({
      MATCH: `${prefix}*`,
      COUNT: 100
    })) {
      const keys = scannedKeys.filter((key) => {
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
      if (seenKeys.size > projectPresenceMaximumConnections) {
        throw new Error("Project presence connection limit reached");
      }
      if (keys.length === 0) continue;
      const values = await this.client.mGet(keys);
      for (let index = 0; index < values.length; index += 1) {
        const serialized = values[index];
        const key = keys[index];
        if (!serialized || !key) continue;
        try {
          const participant = projectPresenceParticipant(
            JSON.parse(serialized) as unknown
          );
          if (key !== presenceKey(projectId, participant.connectionId)) {
            throw new Error("Presence key identity mismatch");
          }
          participants.set(participant.connectionId, participant);
        } catch {
          await this.client.del(key);
        }
      }
    }
    return [...participants.values()];
  }

  public async remove(
    projectId: string,
    connectionId: string
  ): Promise<void> {
    await this.client.del(presenceKey(projectId, connectionId));
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.close();
  }
}

function presenceProjectPrefix(projectId: string): string {
  if (!UUID_PATTERN.test(projectId)) {
    throw new Error("Invalid project presence scope");
  }
  return `${PROJECT_PRESENCE_REDIS_PREFIX}:${projectId}:`;
}

function presenceKey(projectId: string, connectionId: string): string {
  if (!CONNECTION_ID_PATTERN.test(connectionId)) {
    throw new Error("Invalid project presence connection");
  }
  return `${presenceProjectPrefix(projectId)}${connectionId}`;
}

function ignoreRedisError(): void {
  // Every Redis operation is awaited at the collaboration boundary.
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
