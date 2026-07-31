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
import { bullMqConnectionOptions } from "./bullmq-keyspace.js";
import {
  enqueueUploadInspection,
  UPLOAD_INSPECTION_QUEUE,
  type UploadInspectionJobData
} from "./upload-inspection.queue.js";
import {
  enqueueSemanticImport,
  enqueueSemanticImportPublish,
  enqueueSemanticImportValidation,
  SEMANTIC_IMPORT_QUEUE,
  type SemanticImportJobData
} from "./semantic-import.queue.js";
import {
  enqueueIntegrationCredentialValidation,
  INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
  type IntegrationCredentialValidationJobData
} from "./integration-credential-validation.queue.js";
import {
  enqueueRankPreparation,
  RANK_PREPARATION_QUEUE,
  type RankPreparationJobData
} from "./rank-preparation.queue.js";
import {
  removeRankAutomationScheduler,
  RANK_AUTOMATION_QUEUE,
  type RankAutomationJobData,
  upsertRankAutomationScheduler
} from "./rank-automation.queue.js";
import type {
  AutomationSchedule
} from "@seo-platform/contracts";

export const SYSTEM_QUEUE = "system";

const QUEUE_PRODUCER_CONNECT_TIMEOUT_MS = 2_000;
const QUEUE_PRODUCER_COMMAND_TIMEOUT_MS = 2_000;

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private connection?: Redis;
  private systemQueue?: Queue;
  private uploadInspectionQueue?: Queue<UploadInspectionJobData>;
  private semanticImportQueue?: Queue<SemanticImportJobData>;
  private integrationCredentialValidationQueue?: Queue<IntegrationCredentialValidationJobData>;
  private rankPreparationQueue?: Queue<RankPreparationJobData>;
  private rankAutomationQueue?: Queue<RankAutomationJobData>;

  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      connectTimeout: QUEUE_PRODUCER_CONNECT_TIMEOUT_MS,
      commandTimeout: QUEUE_PRODUCER_COMMAND_TIMEOUT_MS
    });
    await this.connection.connect();
    this.systemQueue = new Queue(
      SYSTEM_QUEUE,
      bullMqConnectionOptions(this.connection)
    );
    this.uploadInspectionQueue = new Queue(
      UPLOAD_INSPECTION_QUEUE,
      bullMqConnectionOptions(this.connection)
    );
    this.semanticImportQueue = new Queue(
      SEMANTIC_IMPORT_QUEUE,
      bullMqConnectionOptions(this.connection)
    );
    this.integrationCredentialValidationQueue = new Queue(
      INTEGRATION_CREDENTIAL_VALIDATION_QUEUE,
      bullMqConnectionOptions(this.connection)
    );
    this.rankPreparationQueue = new Queue(
      RANK_PREPARATION_QUEUE,
      bullMqConnectionOptions(this.connection)
    );
    this.rankAutomationQueue = new Queue(
      RANK_AUTOMATION_QUEUE,
      bullMqConnectionOptions(this.connection)
    );
  }

  public async onModuleDestroy(): Promise<void> {
    await this.systemQueue?.close();
    await this.uploadInspectionQueue?.close();
    await this.semanticImportQueue?.close();
    await this.integrationCredentialValidationQueue?.close();
    await this.rankPreparationQueue?.close();
    await this.rankAutomationQueue?.close();
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

  public async enqueueSemanticImport(importId: string): Promise<void> {
    if (!this.semanticImportQueue) {
      throw new Error("Semantic import queue is not connected");
    }
    await enqueueSemanticImport(this.semanticImportQueue, importId);
  }

  public async enqueueSemanticImportValidation(
    importId: string,
    version: number
  ): Promise<void> {
    if (!this.semanticImportQueue) {
      throw new Error("Semantic import queue is not connected");
    }
    await enqueueSemanticImportValidation(
      this.semanticImportQueue,
      importId,
      version
    );
  }

  public async enqueueSemanticImportPublish(
    importId: string,
    version: number
  ): Promise<void> {
    if (!this.semanticImportQueue) {
      throw new Error("Semantic import queue is not connected");
    }
    await enqueueSemanticImportPublish(
      this.semanticImportQueue,
      importId,
      version
    );
  }

  public async enqueueIntegrationCredentialValidation(
    jobId: string
  ): Promise<void> {
    if (!this.integrationCredentialValidationQueue) {
      throw new Error(
        "Integration credential validation queue is not connected"
      );
    }
    await enqueueIntegrationCredentialValidation(
      this.integrationCredentialValidationQueue,
      jobId
    );
  }

  public async enqueueRankPreparation(jobId: string): Promise<void> {
    if (!this.rankPreparationQueue) {
      throw new Error("Rank preparation queue is not connected");
    }
    await enqueueRankPreparation(this.rankPreparationQueue, jobId);
  }

  public async upsertRankAutomationScheduler(input: {
    readonly automationId: string;
    readonly automationVersion: number;
    readonly schedule: AutomationSchedule;
    readonly timezone: string;
  }): Promise<Date> {
    if (!this.rankAutomationQueue) {
      throw new Error("Rank automation queue is not connected");
    }
    return upsertRankAutomationScheduler(
      this.rankAutomationQueue,
      input
    );
  }

  public async removeRankAutomationScheduler(
    automationId: string
  ): Promise<boolean> {
    if (!this.rankAutomationQueue) {
      throw new Error("Rank automation queue is not connected");
    }
    return removeRankAutomationScheduler(
      this.rankAutomationQueue,
      automationId
    );
  }
}
