import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap
} from "@nestjs/common";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { SessionService } from "./session.service.js";

export const SESSION_EXPIRY_SWEEPER_SCHEDULER = Symbol(
  "SESSION_EXPIRY_SWEEPER_SCHEDULER"
);
export const SESSION_EXPIRY_SWEEPER_LOGGER = Symbol(
  "SESSION_EXPIRY_SWEEPER_LOGGER"
);

export interface SessionExpirySweeperScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface SessionExpirySweeperLogger {
  warn(message: string): void;
}

interface SessionExpiryCandidate {
  readonly user_id: string;
  readonly family_id: string;
}

interface SessionExpiryDueState {
  readonly is_due: boolean;
}

@Injectable()
export class SessionExpirySweeperService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private scheduledHandle: unknown;
  private activeRun: Promise<number> | undefined;
  private stopping = false;

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    @Inject(SESSION_EXPIRY_SWEEPER_SCHEDULER)
    private readonly scheduler: SessionExpirySweeperScheduler,
    @Inject(SESSION_EXPIRY_SWEEPER_LOGGER)
    private readonly logger: SessionExpirySweeperLogger
  ) {}

  public onApplicationBootstrap(): void {
    if (!this.config.sessionExpirySweeper.enabled) return;
    this.stopping = false;
    this.scheduleNext(0);
  }

  // Prisma closes in the later OnApplicationShutdown phase. Setting stopping
  // here prevents another family transaction from starting while the current
  // transaction remains bounded by the configured database/client timeouts.
  public async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.scheduledHandle !== undefined) {
      this.scheduler.cancel(this.scheduledHandle);
      this.scheduledHandle = undefined;
    }
    await this.activeRun;
  }

  public runOnce(): Promise<number> {
    if (!this.config.sessionExpirySweeper.enabled || this.stopping) {
      return Promise.resolve(0);
    }
    if (this.activeRun) return this.activeRun;

    const run = this.sweepBatch();
    this.activeRun = run;
    const clearActiveRun = (): void => {
      if (this.activeRun === run) this.activeRun = undefined;
    };
    void run.then(clearActiveRun, clearActiveRun);
    return run;
  }

  private async sweepBatch(): Promise<number> {
    const candidates = deduplicateCandidates(
      (await this.loadCandidates()).slice(
        0,
        this.config.sessionExpirySweeper.batchSize
      )
    );
    let revokedFamilies = 0;
    for (const candidate of candidates) {
      if (this.stopping) break;
      if (await this.revokeIfStillDue(candidate)) revokedFamilies += 1;
    }
    return revokedFamilies;
  }

  private loadCandidates(): Promise<readonly SessionExpiryCandidate[]> {
    return this.prisma.$transaction(
      async (transaction) => {
        await this.configureTransactionTimeouts(transaction);
        return transaction.$queryRaw<SessionExpiryCandidate[]>`
          SELECT user_id, family_id
          FROM sessions
          WHERE revoked_at IS NULL
            AND expires_at <= CURRENT_TIMESTAMP
          ORDER BY expires_at ASC, id ASC
          LIMIT ${this.config.sessionExpirySweeper.batchSize}
        `;
      },
      this.transactionOptions()
    );
  }

  private revokeIfStillDue(
    candidate: SessionExpiryCandidate
  ): Promise<boolean> {
    return this.prisma.$transaction(
      async (transaction) => {
        await this.configureTransactionTimeouts(transaction);
        await this.sessions.lockUserSessionLifecycle(
          transaction,
          candidate.user_id
        );
        const dueState = await transaction.$queryRaw<SessionExpiryDueState[]>`
          SELECT EXISTS (
            SELECT 1
            FROM sessions
            WHERE user_id = ${candidate.user_id}::uuid
              AND family_id = ${candidate.family_id}::uuid
              AND revoked_at IS NULL
              AND expires_at <= CURRENT_TIMESTAMP
          ) AS is_due
        `;
        if (dueState[0]?.is_due !== true) return false;

        const revoked = await this.sessions.revokeFamilies(transaction, {
          userId: candidate.user_id,
          familyIds: [candidate.family_id],
          requestId: `session-expiry-${candidate.family_id}`
        });
        return revoked.revokedFamilyIds.includes(candidate.family_id);
      },
      this.transactionOptions()
    );
  }

  private async configureTransactionTimeouts(
    transaction: Prisma.TransactionClient
  ): Promise<void> {
    await transaction.$queryRaw`
      SELECT
        set_config(
          'lock_timeout',
          ${`${this.config.sessionExpirySweeper.lockTimeoutMs}ms`},
          TRUE
        ),
        set_config(
          'statement_timeout',
          ${`${this.config.sessionExpirySweeper.transactionTimeoutMs}ms`},
          TRUE
        )
    `;
  }

  private transactionOptions(): {
    readonly maxWait: number;
    readonly timeout: number;
  } {
    return {
      maxWait: this.config.sessionExpirySweeper.lockTimeoutMs,
      timeout: this.config.sessionExpirySweeper.transactionTimeoutMs
    };
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopping) return;
    this.scheduledHandle = this.scheduler.schedule(() => {
      this.scheduledHandle = undefined;
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopping) return;
    try {
      await this.runOnce();
    } catch {
      this.logger.warn("SESSION_EXPIRY_SWEEPER_TICK_FAILED");
    } finally {
      if (!this.stopping) {
        this.scheduleNext(this.config.sessionExpirySweeper.intervalMs);
      }
    }
  }
}

function deduplicateCandidates(
  candidates: readonly SessionExpiryCandidate[]
): readonly SessionExpiryCandidate[] {
  const unique: SessionExpiryCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.user_id}\u0000${candidate.family_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}
