import { Inject, Injectable } from "@nestjs/common";
import {
  currentRankProviderPolicyVersion,
  batchedArsenkinRankPolicyVersion,
  largeXmlStockRankPolicyVersion,
  rankExecutionPolicyShape,
  supportedRankProviderPolicyVersions,
  xmlStockRankProviderPolicyVersion
} from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";
import {
  BillingEntitlementService
} from "../billing/billing-entitlement.service.js";
import {
  BillingUsageInsufficientBalanceError,
  BillingUsageProviderBudgetExceededError,
  BillingUsageService
} from "../billing/billing-usage.service.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

export const RANK_EXECUTION_GRANT_POLICY = Symbol(
  "RANK_EXECUTION_GRANT_POLICY"
);
export const CONTROLLED_BETA_RANK_POLICY_VERSION =
  currentRankProviderPolicyVersion;

export interface RankExecutionGrantPolicyInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly executionAttempt: number;
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  readonly credentialMode: "BYOK_API_KEY" | "PLATFORM_PAID";
  readonly policyVersion: string;
  readonly usageIntent: {
    readonly meter: "RANK_PROVIDER_TASK";
    readonly quantity: 1;
    readonly unitPriceMinor?: string;
  };
}

export type RankExecutionGrantPolicyDecision =
  | {
      readonly entitlement: "DENIED" | "NOT_AVAILABLE";
      readonly quota: "NOT_AVAILABLE";
      readonly quotaReservationId?: never;
    }
  | {
      readonly entitlement: "ALLOWED";
      readonly quota: "EXHAUSTED" | "NOT_AVAILABLE";
      readonly quotaReservationId?: never;
    }
  | {
      readonly entitlement: "ALLOWED";
      readonly quota: "AVAILABLE" | "UNLIMITED";
      readonly quotaReservationId: string;
    };

export interface RankExecutionGrantPolicy {
  evaluate(
    transaction: Prisma.TransactionClient,
    input: RankExecutionGrantPolicyInput
  ): Promise<RankExecutionGrantPolicyDecision>;
}

@Injectable()
export class ControlledBetaRankExecutionGrantPolicy
  implements RankExecutionGrantPolicy
{
  public constructor(
    private readonly entitlements: BillingEntitlementService,
    private readonly usage: BillingUsageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async evaluate(
    transaction: Prisma.TransactionClient,
    input: RankExecutionGrantPolicyInput
  ): Promise<RankExecutionGrantPolicyDecision> {
    if (
      !supportedRankProviderPolicyVersions.includes(
        input.policyVersion as (typeof supportedRankProviderPolicyVersions)[number]
      ) ||
      !rankExecutionPolicyShape(input.policyVersion, input.provider) ||
      input.usageIntent.meter !== "RANK_PROVIDER_TASK" ||
      input.usageIntent.quantity !== 1 ||
      (input.credentialMode !== "BYOK_API_KEY" &&
        input.credentialMode !== "PLATFORM_PAID") ||
      (input.credentialMode === "BYOK_API_KEY" &&
        input.usageIntent.unitPriceMinor !== undefined) ||
      (input.credentialMode === "PLATFORM_PAID" &&
        (!platformPolicyMatchesProvider(input.provider, input.policyVersion) ||
          !positiveSafeMinor(input.usageIntent.unitPriceMinor)))
    ) {
      return {
        entitlement: "DENIED",
        quota: "NOT_AVAILABLE"
      };
    }
    const entitlement =
      await this.entitlements.rankProviderEntitlement(
        transaction,
        input.workspaceId
      );
    if (entitlement !== "ALLOWED") {
      return {
        entitlement,
        quota: "NOT_AVAILABLE"
      };
    }
    if (input.credentialMode === "PLATFORM_PAID") {
      const pricing = this.config.billing.providerUsage[input.provider];
      if (
        !pricing.enabled ||
        pricing.dailySpendLimitMinor === undefined ||
        pricing.monthlySpendLimitMinor === undefined
      ) {
        return {
          entitlement: "ALLOWED",
          quota: "NOT_AVAILABLE"
        };
      }
      try {
        const reserved = await this.usage.reserve(transaction, {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          jobId: input.jobId,
          jobItemId: input.jobItemId,
          executionAttempt: input.executionAttempt,
          provider: input.provider,
          operation: "POSITIONS",
          quantity: 1,
          unitPriceMinor: BigInt(input.usageIntent.unitPriceMinor!),
          providerDailySpendLimitMinor:
            BigInt(pricing.dailySpendLimitMinor),
          providerMonthlySpendLimitMinor:
            BigInt(pricing.monthlySpendLimitMinor),
          businessReference:
            `rank-provider-task:${input.workspaceId}:` +
            input.jobItemId
        });
        if (reserved.status === "RELEASED") {
          return {
            entitlement: "ALLOWED",
            quota: "NOT_AVAILABLE"
          };
        }
      } catch (error) {
        if (
          error instanceof BillingUsageInsufficientBalanceError ||
          error instanceof BillingUsageProviderBudgetExceededError
        ) {
          return {
            entitlement: "ALLOWED",
            quota: "EXHAUSTED"
          };
        }
        throw error;
      }
    }
    const [clock] = await transaction.$queryRaw<
      readonly { readonly now: Date }[]
    >`SELECT clock_timestamp() AS "now"`;
    if (!clock?.now || Number.isNaN(clock.now.getTime())) {
      return {
        entitlement: "ALLOWED",
        quota: "NOT_AVAILABLE"
      };
    }
    const windowStartedAt = utcDay(clock.now);
    const windowEndsAt = new Date(
      windowStartedAt.getTime() + 24 * 60 * 60 * 1_000
    );
    const reservation =
      await transaction.rankExecutionQuotaReservation.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          jobId: input.jobId,
          jobItemId: input.jobItemId,
          executionAttempt: input.executionAttempt,
          meter: "RANK_PROVIDER_TASK",
          quantity: input.usageIntent.quantity,
          policyVersion: input.policyVersion,
          windowStartedAt,
          windowEndsAt,
          createdAt: clock.now
        },
        select: { id: true }
      });
    return {
      entitlement: "ALLOWED",
      quota: "UNLIMITED",
      quotaReservationId: reservation.id
    };
  }
}

function platformPolicyMatchesProvider(
  provider: "ARSENKIN" | "XMLSTOCK",
  policyVersion: string
): boolean {
  return provider === "ARSENKIN"
    ? [currentRankProviderPolicyVersion, batchedArsenkinRankPolicyVersion].includes(policyVersion as typeof currentRankProviderPolicyVersion)
    : [xmlStockRankProviderPolicyVersion, largeXmlStockRankPolicyVersion].includes(policyVersion as typeof xmlStockRankProviderPolicyVersion);
}

function positiveSafeMinor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9][0-9]{0,15}$/u.test(value) &&
    BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
  );
}

function utcDay(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate()
    )
  );
}
