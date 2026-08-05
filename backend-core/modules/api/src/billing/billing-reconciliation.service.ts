import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown
} from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { BillingService } from "./billing.service.js";

@Injectable()
export class BillingReconciliationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BillingReconciliationService.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopping = false;

  public constructor(
    private readonly billing: BillingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public onApplicationBootstrap(): void {
    if (this.config.billing.reconciliation.enabled) {
      this.schedule(Math.min(10_000, this.intervalMs()));
    }
  }

  public onApplicationShutdown(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => void this.run(), delayMs);
    this.timer.unref();
  }

  private async run(): Promise<void> {
    if (this.stopping) return;
    try {
      const batchSize = this.config.billing.reconciliation.batchSize;
      await this.billing.reconcilePending(batchSize);
      await this.billing.reconcileSubscriptions(batchSize);
    } catch {
      this.logger.warn("Billing reconciliation cycle failed");
    } finally {
      if (!this.stopping) this.schedule(this.intervalMs());
    }
  }

  private intervalMs(): number {
    return this.config.billing.reconciliation.intervalMs;
  }
}
