import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  enqueueUploadInspection,
  UPLOAD_INSPECTION_QUEUE,
  type UploadInspectionJobData
} from "./upload-inspection.queue.js";

export const SYSTEM_QUEUE = "system";

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private connection?: Redis;
  private systemQueue?: Queue;
  private uploadInspectionQueue?: Queue<UploadInspectionJobData>;

  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true
    });
    await this.connection.connect();
    this.systemQueue = new Queue(SYSTEM_QUEUE, {
      connection: this.connection
    });
    this.uploadInspectionQueue = new Queue(UPLOAD_INSPECTION_QUEUE, {
      connection: this.connection
    });
  }

  public async onModuleDestroy(): Promise<void> {
    await this.systemQueue?.close();
    await this.uploadInspectionQueue?.close();
    await this.connection?.quit();
  }

  public async ping(): Promise<void> {
    if (!this.connection) throw new Error("Redis is not connected");
    await this.connection.ping();
  }

  public async enqueueUploadInspection(uploadId: string): Promise<void> {
    if (!this.uploadInspectionQueue) {
      throw new Error("Upload inspection queue is not connected");
    }
    await enqueueUploadInspection(this.uploadInspectionQueue, uploadId);
  }
}
