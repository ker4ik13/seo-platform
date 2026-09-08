import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown
} from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { BillingService } from "./billing.service.js";
import { BillingUsageService } from "./billing-usage.service.js";
import { OperationBillingService } from "./operation-billing.service.js";
import { RefundRequestService } from "./refund-request.service.js";
import { BillingNoticeService } from "./billing-notice.service.js";

@Injectable()
export class BillingReconciliationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BillingReconciliationService.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopping = false;

  public constructor(
    private readonly billing: BillingService,
    private readonly usage: BillingUsageService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly operations?: OperationBillingService,
    @Optional() private readonly refunds?: RefundRequestService,
    @Optional() private readonly notices?: BillingNoticeService
  ) {}

  public onApplicationBootstrap(): void {
    this.schedule(Math.min(10_000, this.intervalMs()));
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
      await this.prisma.$transaction((transaction) =>
        this.usage.releaseExpired(transaction, batchSize)
      );
      try { await this.operations?.reconcile(batchSize); }
      catch { this.logger.error("PROVIDER_USAGE_RECONCILIATION_CYCLE_FAILED"); }
      try { await this.refunds?.reconcile(batchSize); }
      catch { this.logger.error("REFUND_REQUEST_RECONCILIATION_CYCLE_FAILED"); }
      try { await this.notices?.scan(); }
      catch { this.logger.error("BILLING_NOTICE_SCAN_FAILED"); }
      if (this.config.billing.reconciliation.enabled) {
        await this.billing.reconcilePending(batchSize);
        await this.billing.reconcileSubscriptions(batchSize);
      }
    } catch {
      this.logger.error("BILLING_RECONCILIATION_CYCLE_FAILED");
    } finally {
      if (!this.stopping) this.schedule(this.intervalMs());
    }
  }

  private intervalMs(): number {
    return this.config.billing.reconciliation.intervalMs;
  }
}
