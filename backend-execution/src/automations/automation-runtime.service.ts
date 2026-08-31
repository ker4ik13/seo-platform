import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { bullMqConnectionOptions } from "../queue/bullmq-keyspace.js";
import {
  RANK_AUTOMATION_JOB,
  RANK_AUTOMATION_QUEUE,
  scheduledOccurrence,
  type RankAutomationJobData
} from "../queue/rank-automation.queue.js";
import { AutomationExecutionService } from "./automation-execution.service.js";
import { AutomationService } from "./automation.service.js";

const RECONCILIATION_INTERVAL_MS = 30_000;

@Injectable()
export class AutomationRuntimeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutomationRuntimeService.name);
  private connection?: Redis;
  private worker?: Worker<RankAutomationJobData>;
  private timer?: NodeJS.Timeout;
  private reconciling = false;

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly executions: AutomationExecutionService,
    private readonly automations: AutomationService
  ) {}

  public async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true
    });
    this.connection.on("error", () => {
      this.logger.error("Rank automation Redis connection error");
    });
    this.worker = new Worker<RankAutomationJobData>(
      RANK_AUTOMATION_QUEUE,
      async (job) => {
        if (
          job.name !== RANK_AUTOMATION_JOB ||
          !UUID_PATTERN.test(job.data.automationId) ||
          !Number.isSafeInteger(job.data.automationVersion) ||
          job.data.automationVersion < 1
        ) {
          throw new Error("Invalid rank automation queue message");
        }
        await this.executions.executeScheduled(
          job.data.automationId,
          job.data.automationVersion,
          scheduledOccurrence(job)
        );
      },
      {
        ...bullMqConnectionOptions(this.connection),
        concurrency: 2
      }
    );
    this.worker.on("error", () => {
      this.logger.error("Rank automation worker error");
    });
    this.worker.on("failed", () => {
      this.logger.error("One rank automation delivery failed");
    });
    await this.reconcile();
    this.timer = setInterval(
      () => void this.reconcile(),
      RECONCILIATION_INTERVAL_MS
    );
    this.timer.unref();
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.connection?.quit();
  }

  private async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.executions.settleDispatched();
      await this.executions.recoverRunning();
      await this.automations.reconcileSchedulers();
    } catch {
      this.logger.error("Rank automation reconciliation failed");
    } finally {
      this.reconciling = false;
    }
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
