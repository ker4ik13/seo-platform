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
  CRAWL_AUTOMATION_JOB,
  CRAWL_AUTOMATION_QUEUE,
  crawlScheduledOccurrence,
  type CrawlAutomationJobData
} from "../queue/crawl-automation.queue.js";
import { CrawlAutomationExecutionService } from "./crawl-automation-execution.service.js";
import { CrawlAutomationService } from "./crawl-automation.service.js";

const RECONCILIATION_INTERVAL_MS = 30_000;

@Injectable()
export class CrawlAutomationRuntimeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CrawlAutomationRuntimeService.name);
  private connection?: Redis;
  private worker?: Worker<CrawlAutomationJobData>;
  private timer?: NodeJS.Timeout;
  private reconciling = false;

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly executions: CrawlAutomationExecutionService,
    private readonly automations: CrawlAutomationService
  ) {}

  public async onModuleInit(): Promise<void> {
    this.connection = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true
    });
    this.connection.on("error", () => {
      this.logger.error("Crawl automation Redis connection error");
    });
    this.worker = new Worker<CrawlAutomationJobData>(
      CRAWL_AUTOMATION_QUEUE,
      async (job) => {
        if (
          job.name !== CRAWL_AUTOMATION_JOB ||
          !UUID_PATTERN.test(job.data.automationId) ||
          !Number.isSafeInteger(job.data.automationVersion) ||
          job.data.automationVersion < 1
        ) {
          throw new Error("Invalid crawl automation queue message");
        }
        await this.executions.executeScheduled(
          job.data.automationId,
          job.data.automationVersion,
          crawlScheduledOccurrence(job)
        );
      },
      {
        ...bullMqConnectionOptions(this.connection),
        concurrency: 2
      }
    );
    this.worker.on("error", () => {
      this.logger.error("Crawl automation worker error");
    });
    this.worker.on("failed", () => {
      this.logger.error("One crawl automation delivery failed");
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
      this.logger.error("Crawl automation reconciliation failed");
    } finally {
      this.reconciling = false;
    }
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
